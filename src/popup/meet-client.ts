import type { MeetCommand, MeetReply, MeetReport, MeetSnapshot } from '../meet/types';
import { activeTargetTab } from './surface';

export class MeetUnavailableError extends Error {
  constructor() {
    super('Open a Google Meet meeting in this tab to use Meet Assistant. If Meet is already open, refresh the tab once.');
    this.name = 'MeetUnavailableError';
  }
}

async function resolveTabId(): Promise<number> {
  const tab = await activeTargetTab();
  if (tab?.id === undefined) throw new MeetUnavailableError();
  return tab.id;
}

// Messaging a tab needs no extra permission. A tab with no Meet content script simply has no receiver.
async function deliver(tabId: number, command: MeetCommand): Promise<MeetReply> {
  let reply: MeetReply | undefined;
  try {
    reply = await chrome.tabs.sendMessage<MeetCommand, MeetReply>(tabId, command);
  } catch {
    throw new MeetUnavailableError();
  }
  if (!reply || typeof reply !== 'object' || !('ok' in reply)) throw new MeetUnavailableError();
  return reply;
}

async function send(command: MeetCommand): Promise<MeetReply> {
  return deliver(await resolveTabId(), command);
}

/**
 * The current state of the active tab. `snapshot` is null when nothing changed since `since`.
 * A version number only means something for the tab it came from, so it is ignored after a tab switch.
 */
export async function pollMeetState(since?: { tabId: number; version: number }): Promise<{ tabId: number; snapshot: MeetSnapshot | null }> {
  const tabId = await resolveTabId();
  const reply = await deliver(tabId, { type: 'MEET_GET_STATE', sinceVersion: since?.tabId === tabId ? since.version : undefined });
  if (!reply.ok) throw new Error(reply.error);
  if ('unchanged' in reply) return { tabId, snapshot: null };
  if (!('snapshot' in reply)) throw new MeetUnavailableError();
  return { tabId, snapshot: reply.snapshot };
}

export async function runMeetCommand(command: MeetCommand): Promise<MeetSnapshot> {
  const reply = await send(command);
  if (!reply.ok) throw new Error(reply.error);
  if (!('snapshot' in reply)) throw new Error('Meet Assistant did not return its state. Please retry.');
  return reply.snapshot;
}

export async function fetchMeetReport(): Promise<MeetReport> {
  const reply = await send({ type: 'MEET_GET_REPORT' });
  if (!reply.ok) throw new Error(reply.error);
  if (!('report' in reply)) throw new Error('Meet Assistant did not return the report. Please retry.');
  return reply.report;
}

export async function fetchMeetText(type: 'MEET_GET_TRANSCRIPT' | 'MEET_DEBUG_DUMP'): Promise<string> {
  const reply = await send({ type });
  if (!reply.ok) throw new Error(reply.error);
  if (!('text' in reply)) throw new Error('Meet Assistant did not return any text. Please retry.');
  return reply.text;
}
