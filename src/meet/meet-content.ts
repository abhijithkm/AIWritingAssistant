import { RuntimeAIProvider } from '../api/runtime-provider';
import { USER_NAME_KEY } from '../shared/types';
import { Badge } from './badge';
import { CaptionObserver } from './caption-observer';
import { describeCaptionDom } from './debug-dump';
import { detectMeetPage, isMeetHost, watchNavigation } from './meet-detector';
import { MeetingAnalyzer } from './meeting-analyzer';
import { MeetingSession } from './meeting-state';
import { MEET_COMMAND_TYPES, type AnalysisTask, type MeetCommand, type MeetReply } from './types';

const PAGE_POLL_MS = 1_000;
const ANALYSIS_TASKS: readonly AnalysisTask[] = ['summary', 'actions', 'decisions', 'questions', 'email'];

// Reads only the display name key. The settings object (with the API key) is never requested here.
async function readUserName(): Promise<string | undefined> {
  try {
    const stored = await chrome.storage.local.get(USER_NAME_KEY);
    const name: unknown = stored[USER_NAME_KEY];
    return typeof name === 'string' && name.trim() ? name.trim() : undefined;
  } catch {
    return undefined;
  }
}

function isMeetCommand(message: unknown): message is MeetCommand {
  const type = (message as { type?: unknown } | null)?.type;
  return typeof type === 'string' && (MEET_COMMAND_TYPES as readonly string[]).includes(type);
}

/**
 * Entry point of the Meet content script. It is only injected on meet.google.com, and the hostname
 * is checked again here so Meet logic can never run anywhere else. Returns a function that undoes it.
 */
export function initMeetContent(options: { hostname?: string } = {}): () => void {
  if (!isMeetHost(options.hostname)) return () => undefined;

  const session = new MeetingSession({
    analyzer: new MeetingAnalyzer(new RuntimeAIProvider()),
    detectPage: () => detectMeetPage(),
    createObserver: (handlers) => new CaptionObserver(handlers),
    getUserName: readUserName,
  });
  const badge = new Badge({ onStop: () => session.stop() });
  const unsubscribe = session.onChange(() => badge.update(session.snapshot()));

  async function handle(command: MeetCommand): Promise<MeetReply> {
    switch (command.type) {
      case 'MEET_GET_STATE': {
        session.refreshPage();
        const snapshot = session.snapshot();
        return command.sinceVersion === snapshot.version
          ? { ok: true, unchanged: true, version: snapshot.version }
          : { ok: true, snapshot };
      }
      case 'MEET_START':
        session.start();
        break;
      case 'MEET_STOP':
        session.stop();
        break;
      case 'MEET_DISCARD':
        session.discard();
        break;
      case 'MEET_ANALYZE':
        if (!ANALYSIS_TASKS.includes(command.task)) return { ok: false, error: 'Unknown analysis request.' };
        // Not awaited: the popup polls for progress, so a closed popup never cancels the work.
        void session.analyze(command.task);
        break;
      case 'MEET_ASK':
        if (typeof command.question !== 'string') return { ok: false, error: 'Type a question about the meeting first.' };
        void session.ask(command.question);
        break;
      case 'MEET_GET_TRANSCRIPT':
        return { ok: true, text: session.getTranscriptText() };
      case 'MEET_GET_REPORT':
        return { ok: true, report: session.getReport() };
      case 'MEET_DEBUG_DUMP':
        return { ok: true, text: describeCaptionDom() };
    }
    return { ok: true, snapshot: session.snapshot() };
  }

  const onMessage = (message: unknown, sender: { id?: string }, sendResponse: (reply: MeetReply) => void): boolean => {
    if (sender.id !== chrome.runtime.id || !isMeetCommand(message)) return false;
    handle(message).then(sendResponse, (error: unknown) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Meet Assistant could not do that.' });
    });
    return true;
  };
  chrome.runtime.onMessage.addListener(onMessage);

  const stopWatching = watchNavigation(() => session.handleNavigation());
  const pagePoll = setInterval(() => session.refreshPage(), PAGE_POLL_MS);

  return () => {
    clearInterval(pagePoll);
    stopWatching();
    unsubscribe();
    chrome.runtime.onMessage.removeListener(onMessage);
    session.stop();
  };
}

initMeetContent();
