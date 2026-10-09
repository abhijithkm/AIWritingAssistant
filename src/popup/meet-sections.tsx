import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { formatLineRefs as lineRefs } from '../meet/export-format';
import type { ExtractionTask, MeetSnapshot } from '../meet/types';

export interface SectionProps {
  snapshot: MeetSnapshot;
  onRun: (task: ExtractionTask) => void;
  onOpenSettings: () => void;
}

function Problem({ message, onOpenSettings }: { message?: string; onOpenSettings: () => void }) {
  if (!message) return null;
  return (
    <div className="problem" role="alert">
      <p className="error-message">{message}</p>
      {/API key/i.test(message) && <button className="secondary-button" type="button" onClick={onOpenSettings}>Open settings</button>}
    </div>
  );
}

function TaskBar({ label, busyLabel, busy, disabled, hint, onClick }: {
  label: string;
  busyLabel: string;
  busy: boolean;
  disabled: boolean;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <div className="task-bar">
      <button className="secondary-button task-button" type="button" disabled={busy || disabled} onClick={onClick}>
        {busy ? <><span className="spinner" aria-hidden="true" />{busyLabel}</> : label}
      </button>
      {hint && <span className="muted">{hint}</span>}
    </div>
  );
}

// Tells "the AI found nothing" apart from "the AI has not run yet".
const hasRun = (snapshot: MeetSnapshot, task: ExtractionTask): boolean => snapshot.analyzed[task];

function newLinesHint(snapshot: MeetSnapshot, task: ExtractionTask): string | undefined {
  const fresh = snapshot.unanalyzed[task];
  return hasRun(snapshot, task) && fresh > 0 ? `${fresh} new ${fresh === 1 ? 'line' : 'lines'} since the last run` : undefined;
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function LiveSection({ snapshot }: Pick<SectionProps, 'snapshot'>) {
  const list = useRef<HTMLUListElement>(null);
  const stuck = useRef(true);
  const { recentEntries, entryCount } = snapshot;

  // Follow new lines unless the user scrolled up to read earlier ones.
  useEffect(() => {
    const node = list.current;
    if (node && stuck.current) node.scrollTop = node.scrollHeight;
  }, [recentEntries.length, recentEntries.at(-1)?.text]);

  if (recentEntries.length === 0) {
    return (
      <EmptyState>
        {snapshot.phase === 'active'
          ? 'Waiting for captions. Turn on captions in Meet and start talking; lines appear here.'
          : 'No captions were captured.'}
      </EmptyState>
    );
  }
  return (
    <>
      <ul
        className="transcript"
        ref={list}
        onScroll={(event) => {
          const node = event.currentTarget;
          stuck.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
        }}
      >
        {recentEntries.map((entry) => (
          <li key={entry.id}>
            <span className="speaker">{entry.speaker ?? 'Unknown speaker'}</span>
            <span className="line">{entry.text}</span>
          </li>
        ))}
      </ul>
      {entryCount > recentEntries.length && <p className="muted transcript-note">Showing the latest {recentEntries.length} of {entryCount} lines</p>}
    </>
  );
}

export function SummarySection({ snapshot, onRun, onOpenSettings }: SectionProps) {
  const { summary, keyPoints, topics, raw, errors, busy } = snapshot;
  const fresh = snapshot.unanalyzed.summary;
  const currentTopic = topics.at(-1);
  return (
    <>
      <TaskBar
        label={summary && fresh > 0 ? 'Update summary' : 'Summarize'}
        busyLabel="Summarizing…"
        busy={!!busy.summary}
        disabled={snapshot.entryCount === 0}
        hint={newLinesHint(snapshot, 'summary')}
        onClick={() => onRun('summary')}
      />
      <Problem message={errors.summary} onOpenSettings={onOpenSettings} />
      {raw.summary && (
        <div className="raw">
          <p className="muted">The AI reply was not structured, so it is shown as received:</p>
          <pre>{raw.summary}</pre>
        </div>
      )}
      {summary ? (
        <div className="analysis">
          {currentTopic && <p className="topic">Current topic: {currentTopic}</p>}
          <h3>Summary</h3>
          <p>{summary}</p>
          {keyPoints.length > 0 && (
            <>
              <h3>Key points</h3>
              <ul>{keyPoints.map((point) => <li key={point}>{point}</li>)}</ul>
            </>
          )}
        </div>
      ) : !raw.summary && !busy.summary && <EmptyState>Not generated yet. Select Summarize to analyze the transcript so far.</EmptyState>}
    </>
  );
}

export function ActionsSection({ snapshot, onRun, onOpenSettings }: SectionProps) {
  const { actionItems, errors, busy, raw } = snapshot;
  return (
    <>
      <TaskBar label="Find Action Items" busyLabel="Finding action items…" busy={!!busy.actions} disabled={snapshot.entryCount === 0} hint={newLinesHint(snapshot, 'actions')} onClick={() => onRun('actions')} />
      <Problem message={errors.actions} onOpenSettings={onOpenSettings} />
      {raw.actions && <div className="raw"><p className="muted">The AI reply was not structured, so it is shown as received:</p><pre>{raw.actions}</pre></div>}
      {actionItems.length > 0 ? (
        <ul className="items">
          {actionItems.map((item) => (
            <li key={item.id}>
              <span className="mark" aria-hidden="true">☐</span>
              <div>
                <p>{item.task}</p>
                <p className="muted">
                  {item.owner ? `Owner: ${item.owner}` : 'No owner stated'}
                  {item.deadline ? ` · Due: ${item.deadline}` : ''}
                  {item.sourceEntryIds.length > 0 ? ` · ${lineRefs(item.sourceEntryIds)}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : !raw.actions && !busy.actions && (
        <EmptyState>{hasRun(snapshot, 'actions') ? 'No action items found in the transcript so far.' : 'Not generated yet. Select Find Action Items to analyze the transcript so far.'}</EmptyState>
      )}
    </>
  );
}

export function DecisionsSection({ snapshot, onRun, onOpenSettings }: SectionProps) {
  const { decisions, errors, busy, raw } = snapshot;
  return (
    <>
      <TaskBar label="Find Decisions" busyLabel="Finding decisions…" busy={!!busy.decisions} disabled={snapshot.entryCount === 0} hint={newLinesHint(snapshot, 'decisions')} onClick={() => onRun('decisions')} />
      <Problem message={errors.decisions} onOpenSettings={onOpenSettings} />
      {raw.decisions && <div className="raw"><p className="muted">The AI reply was not structured, so it is shown as received:</p><pre>{raw.decisions}</pre></div>}
      {decisions.length > 0 ? (
        <ul className="items">
          {decisions.map((item) => (
            <li key={item.id}>
              <span className="mark ok" aria-hidden="true">✓</span>
              <div>
                <p>{item.decision}</p>
                {item.sourceEntryIds.length > 0 && <p className="muted">{lineRefs(item.sourceEntryIds)}</p>}
              </div>
            </li>
          ))}
        </ul>
      ) : !raw.decisions && !busy.decisions && (
        <EmptyState>{hasRun(snapshot, 'decisions') ? 'No decisions found in the transcript so far.' : 'Not generated yet. Select Find Decisions to analyze the transcript so far.'}</EmptyState>
      )}
    </>
  );
}

export function QuestionsSection({ snapshot, onRun, onOpenSettings }: SectionProps) {
  const { questions, errors, busy, raw } = snapshot;
  return (
    <>
      <TaskBar label="Find Questions" busyLabel="Finding questions…" busy={!!busy.questions} disabled={snapshot.entryCount === 0} hint={newLinesHint(snapshot, 'questions')} onClick={() => onRun('questions')} />
      <Problem message={errors.questions} onOpenSettings={onOpenSettings} />
      {raw.questions && <div className="raw"><p className="muted">The AI reply was not structured, so it is shown as received:</p><pre>{raw.questions}</pre></div>}
      {questions.length > 0 ? (
        <ul className="items">
          {questions.map((item) => (
            <li key={item.id}>
              <span className="mark" aria-hidden="true">?</span>
              <div>
                <p>{item.question}</p>
                <p className="muted">
                  {item.status ?? 'unknown'}
                  {item.sourceEntryIds.length > 0 ? ` · ${lineRefs(item.sourceEntryIds)}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : !raw.questions && !busy.questions && (
        <EmptyState>{hasRun(snapshot, 'questions') ? 'No questions or open issues found in the transcript so far.' : 'Not generated yet. Select Find Questions to analyze the transcript so far.'}</EmptyState>
      )}
    </>
  );
}

export function AskSection({ snapshot, onAsk, onOpenSettings }: { snapshot: MeetSnapshot; onAsk: (question: string) => void; onOpenSettings: () => void }) {
  const [question, setQuestion] = useState('');
  const asking = !!snapshot.busy.ask;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (!text || asking || snapshot.entryCount === 0) return;
    onAsk(text);
    setQuestion('');
  }

  return (
    <section className="ask" aria-label="Ask the meeting">
      {snapshot.qa.slice(-3).map((item) => (
        <div className="qa" key={item.id}>
          <p className="qa-question">{item.question}</p>
          {item.pending && <p className="muted"><span className="spinner" aria-hidden="true" /> Thinking…</p>}
          {item.error && <Problem message={item.error} onOpenSettings={onOpenSettings} />}
          {item.answer && <p className="qa-answer">{item.answer}</p>}
        </div>
      ))}
      <form className="ask-form" onSubmit={submit}>
        <input
          aria-label="Ask the meeting"
          placeholder="Ask the meeting…"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button className="secondary-button" type="submit" disabled={!question.trim() || asking || snapshot.entryCount === 0}>Ask</button>
      </form>
    </section>
  );
}
