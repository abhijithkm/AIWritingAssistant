import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDuration, formatMeetingSummary } from '../meet/export-format';
import type { AnalysisTask, CaptionsStatus, ExtractionTask, MeetCommand, MeetSnapshot } from '../meet/types';
import { saveReport } from '../report/report-store';
import { fetchMeetReport, fetchMeetText, MeetUnavailableError, pollMeetState, runMeetCommand } from './meet-client';
import { ActionsSection, AskSection, DecisionsSection, LiveSection, QuestionsSection, SummarySection } from './meet-sections';

const POLL_MS = 1_000;
const FLASH_MS = 2_500;
const CONSENT = 'Meet Assistant processes the captions currently visible in Google Meet. AI analysis may send selected transcript text to OpenRouter.';
// The required sentence above stays word for word. This adds what the AI buttons really send.
const CONSENT_DETAIL = 'Summaries and the follow-up email send the transcript so far to OpenRouter, and a free route may be logged by its provider. Tell the other participants you are using an assistant.';
const CAPTIONS_OFF = 'Captions are currently disabled. Turn on captions in Google Meet to use Meet Assistant.';
const CAPTIONS_UNKNOWN = 'Captions not detected yet. Turn on captions in Google Meet to use Meet Assistant.';

type TabId = 'live' | 'summary' | 'actions' | 'decisions' | 'questions';

const captionsLabel: Record<CaptionsStatus, string> = { on: '● On', off: '○ Off', unknown: '○ Not detected' };

function captionsHint(status: CaptionsStatus): string | null {
  if (status === 'off') return CAPTIONS_OFF;
  return status === 'unknown' ? CAPTIONS_UNKNOWN : null;
}

export default function MeetPanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [snapshot, setSnapshot] = useState<MeetSnapshot | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [tab, setTab] = useState<TabId>('live');
  const [commandError, setCommandError] = useState('');
  const [flash, setFlash] = useState('');
  // Which tab and version the last snapshot came from, so unchanged polls can be skipped cheaply.
  const seen = useRef<{ tabId: number; version: number } | undefined>(undefined);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // State lives in the Meet tab, so closing the popup never loses or cancels anything.
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await pollMeetState(seen.current);
        if (cancelled) return;
        setUnavailable(false);
        if (next.snapshot) {
          seen.current = { tabId: next.tabId, version: next.snapshot.version };
          setSnapshot(next.snapshot);
        }
      } catch (error) {
        if (cancelled || !(error instanceof MeetUnavailableError)) return;
        seen.current = undefined;
        setSnapshot(null);
        setUnavailable(true);
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(flashTimer.current);
    };
  }, []);

  const showFlash = useCallback((message: string) => {
    setFlash(message);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), FLASH_MS);
  }, []);

  const command = useCallback(async (next: MeetCommand) => {
    setCommandError('');
    try {
      const updated = await runMeetCommand(next);
      // The next poll fetches a full snapshot, which also covers a tab switch during the command.
      seen.current = undefined;
      setSnapshot(updated);
    } catch (error) {
      if (error instanceof MeetUnavailableError) {
        setUnavailable(true);
        setSnapshot(null);
      } else {
        setCommandError(error instanceof Error ? error.message : 'Meet Assistant could not do that.');
      }
    }
  }, []);

  const copy = useCallback(async (label: string, getText: () => Promise<string> | string) => {
    setCommandError('');
    try {
      const text = await getText();
      if (!text) {
        showFlash('Nothing to copy yet.');
        return;
      }
      await navigator.clipboard.writeText(text);
      showFlash(`${label} copied`);
    } catch (error) {
      setCommandError(error instanceof Error && !(error instanceof DOMException) ? error.message : 'Clipboard access was denied. Select and copy the text manually.');
    }
  }, [showFlash]);

  // The popup closes as soon as another tab takes focus, so the report is saved before the tab opens.
  const openReport = useCallback(async () => {
    setCommandError('');
    try {
      await saveReport(await fetchMeetReport());
      await chrome.tabs.create({ url: chrome.runtime.getURL('report.html') });
    } catch (error) {
      if (error instanceof MeetUnavailableError) {
        setUnavailable(true);
        setSnapshot(null);
      } else {
        setCommandError(error instanceof Error ? error.message : 'The report could not be opened.');
      }
    }
  }, []);

  const analyze = (task: AnalysisTask) => void command({ type: 'MEET_ANALYZE', task });
  const run = (task: ExtractionTask) => analyze(task);

  if (unavailable) {
    return (
      <section className="card meet-card" aria-label="Meet Assistant">
        <div className="card-heading"><div><h2>Meet Assistant</h2><p className="muted">Live captions to summary, actions and follow-up.</p></div></div>
        <p className="empty">Open a Google Meet meeting in this tab to use Meet Assistant. If Meet is already open, refresh the tab once.</p>
        <button
          className="secondary-button wide"
          type="button"
          onClick={() => void chrome.tabs.create({ url: 'https://meet.google.com/landing' })}
        >
          Open Google Meet
        </button>
      </section>
    );
  }

  if (!snapshot) {
    return <section className="card meet-card" aria-busy="true"><p className="muted"><span className="spinner" aria-hidden="true" /> Checking this tab…</p></section>;
  }

  const { phase, page } = snapshot;
  const hint = captionsHint(page.captions);

  const startControls = confirming ? (
    <div className="consent" role="group" aria-label="Before you start">
      <p>{CONSENT}</p>
      <p>{CONSENT_DETAIL}</p>
      <div className="result-actions">
        <button className="primary-button compact" type="button" onClick={() => { setConfirming(false); void command({ type: 'MEET_START' }); }}>Start Assistant</button>
        <button className="secondary-button" type="button" onClick={() => setConfirming(false)}>Cancel</button>
      </div>
    </div>
  ) : null;

  if (phase === 'idle') {
    return (
      <section className="card meet-card" aria-label="Meet Assistant">
        <div className="card-heading">
          <div>
            <h2>Meet Assistant</h2>
            <p className="muted">{page.meetingDetected ? 'Meeting detected' : 'Google Meet detected, no meeting yet'}</p>
          </div>
        </div>
        <dl className="meet-status">
          <div><dt>Captions</dt><dd className={`captions-${page.captions}`}>{captionsLabel[page.captions]}</dd></div>
          <div><dt>Assistant</dt><dd>○ Stopped</dd></div>
        </dl>
        {!page.meetingDetected && <p className="hint-line">Join or start a meeting to use Meet Assistant.</p>}
        {page.meetingDetected && hint && <p className="hint-line">{hint}</p>}
        {commandError && <p className="error-message" role="alert">{commandError}</p>}
        {confirming ? startControls : (
          <button className="primary-button" type="button" disabled={!page.meetingDetected} onClick={() => setConfirming(true)}>Start Assistant</button>
        )}
        <MeetFooter onDebug={() => void copy('Debug info', () => fetchMeetText('MEET_DEBUG_DUMP'))} flash={flash} />
      </section>
    );
  }

  const active = phase === 'active';
  const counts: Record<TabId, number | null> = {
    live: null, summary: null, actions: snapshot.actionItems.length, decisions: snapshot.decisions.length, questions: snapshot.questions.length,
  };
  const tabs: Array<[TabId, string]> = [['live', 'Live'], ['summary', 'Summary'], ['actions', 'Actions'], ['decisions', 'Decisions'], ['questions', 'Questions']];
  const sectionProps = { snapshot, onRun: run, onOpenSettings };

  return (
    <section className="card meet-card" aria-label="Meet Assistant">
      <div className="meet-top">
        {active
          ? <span className="live-badge"><i aria-hidden="true" />Meet Assistant active</span>
          : <h2>Meeting complete</h2>}
        {active && <button className="secondary-button stop-button" type="button" onClick={() => void command({ type: 'MEET_STOP' })}>Stop Assistant</button>}
      </div>

      {active && <p className="muted">Reading the captions visible in Meet. Text goes to OpenRouter only when you use an AI button.</p>}
      {active && hint && <p className="hint-line">{hint}</p>}
      {snapshot.notice && <p className="hint-line" role="status">{snapshot.notice}</p>}
      {commandError && <p className="error-message" role="alert">{commandError}</p>}

      {!active && (
        <div className="complete">
          <p>Duration: {formatDuration(snapshot.startedAt, snapshot.endedAt)}</p>
          <p>Transcript: {snapshot.entryCount} {snapshot.entryCount === 1 ? 'entry' : 'entries'}</p>
          <div className="result-actions wrap">
            <button className="secondary-button" type="button" onClick={() => void copy('Summary', () => formatMeetingSummary(snapshot))}>Copy Summary</button>
            <button className="secondary-button" type="button" onClick={() => void copy('Transcript', () => fetchMeetText('MEET_GET_TRANSCRIPT'))}>Copy Transcript</button>
          </div>
          <button className="secondary-button wide" type="button" disabled={snapshot.entryCount === 0} onClick={() => void openReport()}>Open full report</button>
          <p className="muted">Shows the transcript and everything generated so far. You can generate the rest on the report page.</p>
          <button className="primary-button compact" type="button" disabled={!!snapshot.busy.email || snapshot.entryCount === 0} onClick={() => analyze('email')}>
            {snapshot.busy.email ? <><span className="spinner" aria-hidden="true" />Preparing email…</> : 'Generate Follow-up Email'}
          </button>
          {snapshot.errors.email && (
            <div className="problem" role="alert">
              <p className="error-message">{snapshot.errors.email}</p>
              {/API key/i.test(snapshot.errors.email) && <button className="secondary-button" type="button" onClick={onOpenSettings}>Open settings</button>}
            </div>
          )}
          {snapshot.followUpEmail && (
            <div className="email">
              <textarea className="writing-result" aria-label="Follow-up email" readOnly value={snapshot.followUpEmail} />
              <button className="secondary-button wide" type="button" onClick={() => void copy('Email', () => snapshot.followUpEmail ?? '')}>Copy Email</button>
            </div>
          )}
          {confirming ? startControls : (
            <div className="result-actions wrap">
              <button className="secondary-button" type="button" disabled={!page.meetingDetected} onClick={() => setConfirming(true)}>Resume Assistant</button>
              <button className="secondary-button" type="button" onClick={() => void command({ type: 'MEET_DISCARD' })}>Discard transcript</button>
            </div>
          )}
        </div>
      )}

      <div className="meet-tabs" role="tablist" aria-label="Meeting sections">
        {tabs.map(([id, label]) => (
          <button key={id} className="meet-tab" role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}{counts[id] ? <span className="count">{counts[id]}</span> : null}
          </button>
        ))}
      </div>
      <div className="meet-panel" role="tabpanel">
        {tab === 'live' && <LiveSection snapshot={snapshot} />}
        {tab === 'summary' && <SummarySection {...sectionProps} />}
        {tab === 'actions' && <ActionsSection {...sectionProps} />}
        {tab === 'decisions' && <DecisionsSection {...sectionProps} />}
        {tab === 'questions' && <QuestionsSection {...sectionProps} />}
      </div>

      <AskSection snapshot={snapshot} onAsk={(question) => void command({ type: 'MEET_ASK', question })} onOpenSettings={onOpenSettings} />
      <MeetFooter onDebug={() => void copy('Debug info', () => fetchMeetText('MEET_DEBUG_DUMP'))} flash={flash} />
    </section>
  );
}

function MeetFooter({ onDebug, flash }: { onDebug: () => void; flash: string }) {
  return (
    <div className="meet-footer">
      <p className="muted">The transcript stays in this tab until you close or reload it.</p>
      <button className="link-button" type="button" onClick={onDebug}>Copy caption debug info</button>
      <p className="muted flash" role="status">{flash}</p>
    </div>
  );
}
