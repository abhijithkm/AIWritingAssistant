import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RuntimeAIProvider } from '../api/runtime-provider';
import { formatClock, formatDuration, formatLineRefs, formatMeetingSummary, formatTranscript } from '../meet/export-format';
import { MeetingAnalyzer } from '../meet/meeting-analyzer';
import type { MeetReport, TranscriptEntry } from '../meet/types';
import DeveloperCredit from '../popup/DeveloperCredit';
import type { AIProvider } from '../shared/types';
import { isSectionDone, missingSections, readUserName, runSection, type ReportSection } from './report-analysis';
import { clearReport, loadReport, saveReport } from './report-store';

type View =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'deleted' }
  | { kind: 'ready'; report: MeetReport };

const QUOTE_LENGTH = 140;

const truncate = (text: string, length: number): string => (text.length > length ? `${text.slice(0, length).trimEnd()}…` : text);

// A section that has no content yet: either the AI found nothing, or it has not been asked.
function Missing({ ran, none, label, busyLabel, busy, locked, error, onGenerate }: {
  ran: boolean;
  none: string;
  label: string;
  busyLabel: string;
  busy: boolean;
  locked: boolean;
  error?: string;
  onGenerate: () => void;
}) {
  if (ran) return <p className="empty">{none}</p>;
  return (
    <div className="missing">
      <p className="empty">Not generated yet.</p>
      <button className="secondary-button no-print" type="button" disabled={locked} onClick={onGenerate}>
        {busy ? <><span className="spinner" aria-hidden="true" />{busyLabel}</> : label}
      </button>
      {error && <p className="error-message" role="alert">{error}</p>}
    </div>
  );
}

// The line an analysis points at, so each item can be checked against what was actually said.
function Evidence({ ids, entries }: { ids: string[]; entries: Map<string, TranscriptEntry> }) {
  const cited = ids.flatMap((id) => entries.get(id) ?? []);
  if (cited.length === 0) return null;
  const [first] = cited;
  return (
    <>
      <p className="quote">“{truncate(first.text, QUOTE_LENGTH)}” <span className="muted">{first.speaker ?? 'Unknown speaker'}</span></p>
      <p className="muted">{formatLineRefs(ids)}</p>
    </>
  );
}

export default function ReportApp({ provider }: { provider?: AIProvider }) {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [showTranscript, setShowTranscript] = useState(true);
  const [flash, setFlash] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState<ReportSection | 'all' | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ReportSection, string>>>({});
  const current = useRef<MeetReport | null>(null);

  useEffect(() => {
    document.title = 'Meeting report — AI Writer';
    let cancelled = false;
    loadReport().then(
      (report) => { if (!cancelled) setView(report ? { kind: 'ready', report } : { kind: 'missing' }); },
      () => { if (!cancelled) setView({ kind: 'missing' }); },
    );
    return () => { cancelled = true; };
  }, []);

  const report = view.kind === 'ready' ? view.report : null;
  current.current = report;
  const byId = useMemo(() => new Map((report?.entries ?? []).map((entry) => [entry.id, entry])), [report]);
  const analyzer = useMemo(() => new MeetingAnalyzer(provider ?? new RuntimeAIProvider()), [provider]);

  // Keeps the page and the stored copy in step, so a reload shows what was generated.
  const commit = useCallback((next: MeetReport) => {
    current.current = next;
    setView({ kind: 'ready', report: next });
    void (async () => {
      try { await saveReport(next); } catch { /* the page still shows the result */ }
    })();
  }, []);

  async function generate(section: ReportSection): Promise<boolean> {
    const base = current.current;
    if (!base) return false;
    setErrors((previous) => ({ ...previous, [section]: undefined }));
    try {
      await runSection(base, section, { analyzer, userName: await readUserName(), commit });
      return true;
    } catch (error) {
      setErrors((previous) => ({ ...previous, [section]: error instanceof Error ? error.message : 'Something went wrong. Please retry.' }));
      return false;
    }
  }

  async function start(which: ReportSection | 'all') {
    if (busy) return;
    setBusy(which);
    try {
      if (which !== 'all') {
        await generate(which);
        return;
      }
      for (const section of missingSections(current.current!)) {
        if (!(await generate(section))) break;
      }
    } finally {
      setBusy(null);
    }
  }

  async function copy(label: string, text: string) {
    setProblem('');
    try {
      await navigator.clipboard.writeText(text);
      setFlash(`${label} copied`);
    } catch {
      setProblem('Clipboard access was denied. Select and copy the text manually.');
    }
  }

  async function remove() {
    setProblem('');
    try {
      await clearReport();
      setView({ kind: 'deleted' });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The report could not be deleted.');
    }
  }

  if (view.kind === 'loading') {
    return <main className="report"><p className="muted"><span className="spinner" aria-hidden="true" /> Loading report…</p></main>;
  }

  if (!report) {
    return (
      <main className="report">
        <section className="card">
          <h1>{view.kind === 'deleted' ? 'This report was deleted' : 'No report found'}</h1>
          <p className="empty">
            {view.kind === 'deleted'
              ? 'It has been removed from browser memory. Your meeting tab still holds its own copy until you close or reload it.'
              : 'Reports are kept in browser memory only and are cleared when Chrome closes. Open Meet Assistant on your meeting tab, stop the assistant, and select Open full report.'}
          </p>
        </section>
        <DeveloperCredit />
      </main>
    );
  }

  const when = new Date(report.endedAt ?? report.generatedAt).toLocaleString();
  const start0 = report.startedAt ?? report.entries[0]?.timestamp ?? 0;
  const currentTopic = report.topics.at(-1);
  const locked = busy !== null;
  const toGenerate = missingSections(report);
  const ran = (section: 'actions' | 'decisions' | 'questions') => isSectionDone(report, section);
  // While "generate all" runs, every analysis section that is still empty shows as working.
  const isBusy = (section: ReportSection): boolean => busy === section
    || (busy === 'all' && section !== 'email' && !isSectionDone(report, section));
  const missingProps = (section: ReportSection, label: string, busyLabel: string) => ({
    label, busyLabel, locked, busy: isBusy(section), error: errors[section], onGenerate: () => void start(section),
  });

  return (
    <main className="report">
      <header className="report-head">
        <div>
          <h1>Meeting report</h1>
          <p className="muted">{report.meetingCode ? `Meeting ${report.meetingCode} · ` : ''}{when}</p>
        </div>
        <div className="report-actions no-print">
          <button className="secondary-button" type="button" onClick={() => window.print()}>Print or save as PDF</button>
          <button className="secondary-button" type="button" onClick={() => void remove()}>Delete this report</button>
        </div>
      </header>

      <section className="card report-facts">
        <p>Duration: {formatDuration(report.startedAt, report.endedAt)}</p>
        <p>Transcript: {report.entries.length} {report.entries.length === 1 ? 'line' : 'lines'}</p>
        {toGenerate.length > 0 && (
          <div className="generate-all no-print">
            <button className="primary-button compact" type="button" disabled={locked} onClick={() => void start('all')}>
              {busy === 'all' ? <><span className="spinner" aria-hidden="true" />Generating…</> : 'Generate summary and analysis'}
            </button>
            <p className="muted">Sends this transcript to OpenRouter with the API key saved in AI Writer settings. Nothing is sent until you press a button.</p>
          </div>
        )}
        <p className="muted no-print">This copy lives in browser memory until you close Chrome or delete it here.</p>
        <p className="muted flash no-print" role="status">{flash}</p>
      </section>

      {problem && <p className="error-message" role="alert">{problem}</p>}

      <section className="card analysis">
        <div className="report-section-head">
          <h2>Summary</h2>
          {report.summary && <button className="secondary-button no-print" type="button" onClick={() => void copy('Summary', formatMeetingSummary(report))}>Copy summary</button>}
        </div>
        {report.summary ? (
          <>
            {currentTopic && <p className="topic">Current topic: {currentTopic}</p>}
            <p>{report.summary}</p>
            {report.keyPoints.length > 0 && <ul>{report.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul>}
          </>
        ) : <Missing ran={false} none="" {...missingProps('summary', 'Generate summary', 'Summarizing…')} />}
      </section>

      <section className="card">
        <h2>Action items</h2>
        {report.actionItems.length > 0 ? (
          <ul className="items">
            {report.actionItems.map((item) => (
              <li key={item.id}>
                <span className="mark" aria-hidden="true">☐</span>
                <div>
                  <p>{item.task}</p>
                  <p className="muted">{item.owner ? `Owner: ${item.owner}` : 'No owner stated'}{item.deadline ? ` · Due: ${item.deadline}` : ''}</p>
                  <Evidence ids={item.sourceEntryIds} entries={byId} />
                </div>
              </li>
            ))}
          </ul>
        ) : <Missing ran={ran('actions')} none="No action items found in this transcript." {...missingProps('actions', 'Find action items', 'Finding…')} />}
      </section>

      <section className="card">
        <h2>Decisions</h2>
        {report.decisions.length > 0 ? (
          <ul className="items">
            {report.decisions.map((item) => (
              <li key={item.id}>
                <span className="mark ok" aria-hidden="true">✓</span>
                <div>
                  <p>{item.decision}</p>
                  <Evidence ids={item.sourceEntryIds} entries={byId} />
                </div>
              </li>
            ))}
          </ul>
        ) : <Missing ran={ran('decisions')} none="No decisions found in this transcript." {...missingProps('decisions', 'Find decisions', 'Finding…')} />}
      </section>

      <section className="card">
        <h2>Questions and open issues</h2>
        {report.questions.length > 0 ? (
          <ul className="items">
            {report.questions.map((item) => (
              <li key={item.id}>
                <span className="mark" aria-hidden="true">?</span>
                <div>
                  <p>{item.question}</p>
                  <p className="muted">{item.status ?? 'unknown'}</p>
                  <Evidence ids={item.sourceEntryIds} entries={byId} />
                </div>
              </li>
            ))}
          </ul>
        ) : <Missing ran={ran('questions')} none="No questions or open issues found in this transcript." {...missingProps('questions', 'Find questions', 'Finding…')} />}
      </section>

      <section className="card">
        <div className="report-section-head">
          <h2>Follow-up email</h2>
          {report.followUpEmail && <button className="secondary-button no-print" type="button" onClick={() => void copy('Email', report.followUpEmail ?? '')}>Copy email</button>}
        </div>
        {report.followUpEmail
          ? <textarea className="writing-result report-email" aria-label="Follow-up email" readOnly value={report.followUpEmail} />
          : <Missing ran={false} none="" {...missingProps('email', 'Generate follow-up email', 'Writing…')} />}
      </section>

      {report.qa.length > 0 && (
        <section className="card">
          <h2>Questions you asked</h2>
          {report.qa.map((item) => (
            <div className="qa" key={item.id}>
              <p className="qa-question">{item.question}</p>
              <p className="qa-answer">{item.answer}</p>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <div className="report-section-head">
          <h2>Transcript</h2>
          <div className="report-actions no-print">
            <button className="secondary-button" type="button" onClick={() => void copy('Transcript', formatTranscript(report.entries, { startedAt: report.startedAt, meetingCode: report.meetingCode }))}>Copy transcript</button>
            <button className="secondary-button" type="button" aria-expanded={showTranscript} onClick={() => setShowTranscript((open) => !open)}>
              {showTranscript ? 'Hide transcript' : `Show transcript (${report.entries.length} lines)`}
            </button>
          </div>
        </div>
        {showTranscript && (
          <ul className="report-transcript">
            {report.entries.map((entry) => (
              <li key={entry.id}>
                <span className="clock">{formatClock(entry.timestamp - start0)}</span>
                <span className="speaker">{entry.speaker ?? 'Unknown speaker'}</span>
                <span className="line">{entry.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DeveloperCredit />
    </main>
  );
}
