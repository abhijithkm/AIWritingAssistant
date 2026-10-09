import type { ObserverStatus } from './caption-observer';
import { formatTranscript } from './export-format';
import {
  CHUNK_OVERLAP,
  MalformedResponseError,
  dedupeKey,
  digestFrom,
  entriesSince,
  formatDigest,
  type MeetingAnalyzer,
  type MeetingDigest,
  type SummaryResult,
} from './meeting-analyzer';
import { TranscriptManager } from './transcript-manager';
import type {
  ActionItem,
  AnalysisTask,
  CaptionEvent,
  Decision,
  ExtractionTask,
  MeetingState,
  MeetPageStatus,
  MeetReport,
  MeetPhase,
  MeetSnapshot,
  QAItem,
  Question,
} from './types';

export interface ObserverHandle {
  start(): void;
  stop(): void;
}

export interface ObserverHandlers {
  onCaption(caption: CaptionEvent): void;
  onStatus?(status: ObserverStatus): void;
}

export interface SessionDeps {
  analyzer: MeetingAnalyzer;
  detectPage: () => MeetPageStatus;
  createObserver: (handlers: ObserverHandlers) => ObserverHandle;
  getUserName?: () => Promise<string | undefined>;
  now?: () => number;
}

const RECENT_LIMIT = 100;
const MAX_QA = 20;
const EMPTY_TRANSCRIPT = 'There is no transcript yet. Wait for captions to appear first.';
const NOT_A_MEETING = 'Open a Google Meet meeting first. Meet Assistant only works on a meeting page at meet.google.com.';
const LEFT_MEETING = 'Meet Assistant stopped because you left the meeting. Your transcript stays available until you start the assistant in another meeting, or close or reload this tab.';
const CANCELLED = 'Cancelled because Meet Assistant was stopped.';
const MALFORMED = 'The AI reply was not in the expected format.';
const EXTRACTION_ORDER: readonly ExtractionTask[] = ['summary', 'actions', 'decisions', 'questions'];

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : 'Something went wrong. Please retry.');
const union = (a: string[], b: string[]): string[] => [...new Set([...a, ...b])];

/**
 * One meeting's assistant state: the local transcript, the caption observer, and the AI analysis.
 * Everything lives in memory in this tab. AI calls only ever start from an explicit user action.
 */
export class MeetingSession {
  private readonly transcript = new TranscriptManager();
  private observer: ObserverHandle | null = null;
  private readonly listeners = new Set<() => void>();
  private page: MeetPageStatus;
  private phase: MeetPhase = 'idle';
  private startedAt: number | null = null;
  private endedAt: number | null = null;
  private meetingCode: string | null = null;
  private notice: string | undefined;
  private version = 0;

  private summary: string | null = null;
  private keyPoints: string[] = [];
  private topics: string[] = [];
  // Each part summarizes entries [start, end). A part is dropped and rebuilt if one of its entries grows.
  private summaryParts: Array<{ part: SummaryResult; start: number; end: number }> = [];
  private actionItems: ActionItem[] = [];
  private decisions: Decision[] = [];
  private questions: Question[] = [];
  private followUpEmail: string | null = null;
  private qa: QAItem[] = [];
  // Entry revisions as each analysis last saw them. Entries grow in place while someone keeps
  // talking, so counting entries alone would miss text added to an entry that was already analyzed.
  private analyzedRevs: Record<ExtractionTask, number[]> = { summary: [], actions: [], decisions: [], questions: [] };
  private ranOnce: Record<ExtractionTask, boolean> = { summary: false, actions: false, decisions: false, questions: false };
  private counters = { action: 0, decision: 0, question: 0, qa: 0 };

  private busy: Partial<Record<AnalysisTask, boolean>> = {};
  private errors: Partial<Record<AnalysisTask, string>> = {};
  private raw: Partial<Record<ExtractionTask, string>> = {};
  // Bumped by stop/discard: replies from requests started earlier are ignored.
  private epoch = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: SessionDeps) {
    this.page = deps.detectPage();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private bump(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  // --- lifecycle -----------------------------------------------------------------------------

  start(): void {
    this.page = this.deps.detectPage();
    if (!this.page.meetingDetected) throw new Error(NOT_A_MEETING);
    if (this.phase === 'active') return;
    // A different meeting starts a fresh transcript; the same meeting resumes the old one.
    if (this.phase === 'stopped' && this.meetingCode !== this.page.meetingCode) this.resetData();

    this.notice = undefined;
    this.meetingCode = this.page.meetingCode;
    this.startedAt ??= this.now();
    this.endedAt = null;
    this.phase = 'active';
    this.observer ??= this.deps.createObserver({
      onCaption: (caption) => {
        if (this.transcript.ingest(caption) !== 'duplicate') this.bump();
      },
      onStatus: () => this.refreshPage(),
    });
    this.observer.start();
    this.bump();
  }

  stop(): void {
    this.stopWithNotice(undefined);
  }

  private stopWithNotice(notice: string | undefined): void {
    if (this.phase !== 'active') return;
    // Stopping the observer flushes captions that were still settling.
    this.observer?.stop();
    this.phase = 'stopped';
    this.endedAt = this.now();
    this.notice = notice;
    this.cancelPending();
    this.bump();
  }

  discard(): void {
    if (this.phase === 'active') this.observer?.stop();
    this.resetData();
    this.bump();
  }

  private resetData(): void {
    this.cancelPending();
    this.transcript.clear();
    this.phase = 'idle';
    this.startedAt = null;
    this.endedAt = null;
    this.meetingCode = null;
    this.notice = undefined;
    this.summary = null;
    this.keyPoints = [];
    this.topics = [];
    this.summaryParts = [];
    this.actionItems = [];
    this.decisions = [];
    this.questions = [];
    this.followUpEmail = null;
    this.qa = [];
    this.analyzedRevs = { summary: [], actions: [], decisions: [], questions: [] };
    this.ranOnce = { summary: false, actions: false, decisions: false, questions: false };
    this.counters = { action: 0, decision: 0, question: 0, qa: 0 };
    this.errors = {};
    this.raw = {};
  }

  // Index of the first entry that is new or has changed since `task` last ran.
  private firstStale(task: ExtractionTask): number {
    const revisions = this.transcript.revisions;
    const seen = this.analyzedRevs[task];
    for (let index = 0; index < seen.length; index += 1) {
      if (revisions[index] !== seen[index]) return index;
    }
    return seen.length;
  }

  private markAnalyzed(task: ExtractionTask, revisions: number[]): void {
    this.analyzedRevs[task] = revisions;
    this.ranOnce[task] = true;
  }

  private cancelPending(): void {
    this.epoch += 1;
    this.busy = {};
    for (const item of this.qa) {
      if (!item.pending) continue;
      item.pending = false;
      item.error = CANCELLED;
    }
  }

  refreshPage(): void {
    const next = this.deps.detectPage();
    const current = this.page;
    if (next.meetingDetected === current.meetingDetected && next.meetingCode === current.meetingCode && next.captions === current.captions) return;
    this.page = next;
    this.bump();
  }

  /** Call when the page URL changes (Meet is a single-page app). */
  handleNavigation(): void {
    this.refreshPage();
    if (this.phase === 'active' && this.page.meetingCode !== this.meetingCode) this.stopWithNotice(LEFT_MEETING);
  }

  // --- analysis ------------------------------------------------------------------------------

  private enqueue(epoch: number, job: () => Promise<void>): Promise<void> {
    const run = this.queue.then(() => (epoch === this.epoch ? job() : undefined));
    this.queue = run.catch(() => undefined);
    return run.catch(() => undefined);
  }

  private async context(): Promise<{ userName?: string }> {
    return { userName: (await this.deps.getUserName?.())?.trim() || undefined };
  }

  async analyze(task: AnalysisTask): Promise<void> {
    if (this.busy[task]) return;
    const total = this.transcript.entries.length;
    if (total === 0) {
      this.errors[task] = EMPTY_TRANSCRIPT;
      this.bump();
      return;
    }
    // Nothing new or changed since the last run of this analysis: spare the rate limit.
    if (task !== 'email' && this.firstStale(task) >= total) return;

    const epoch = this.epoch;
    this.busy[task] = true;
    delete this.errors[task];
    if (task !== 'email') delete this.raw[task];
    this.bump();

    await this.enqueue(epoch, async () => {
      try {
        await this.run(task, epoch);
      } catch (error) {
        if (epoch === this.epoch) this.recordFailure(task, error);
      }
    });
    if (epoch !== this.epoch) return;
    delete this.busy[task];
    this.bump();
  }

  private recordFailure(task: AnalysisTask, error: unknown): void {
    if (error instanceof MalformedResponseError && task !== 'email') {
      this.raw[task] = error.raw;
      this.errors[task] = MALFORMED;
      return;
    }
    this.errors[task] = errorMessage(error);
  }

  // Runs one analysis step for a follow-up email, reporting its failure on its own tab as well.
  private async prepare(task: ExtractionTask, epoch: number): Promise<void> {
    this.busy[task] = true;
    delete this.errors[task];
    delete this.raw[task];
    this.bump();
    try {
      await this.run(task, epoch);
    } catch (error) {
      if (epoch === this.epoch) this.recordFailure(task, error);
      throw new Error(error instanceof MalformedResponseError ? MALFORMED : errorMessage(error));
    } finally {
      if (epoch === this.epoch) delete this.busy[task];
    }
  }

  private async run(task: AnalysisTask, epoch: number): Promise<void> {
    const entries = [...this.transcript.entries];
    const revisions = [...this.transcript.revisions];
    const total = entries.length;
    const context = { ...(await this.context()), isCancelled: () => epoch !== this.epoch };
    // Stopped or discarded while the user name was loading: do not start anything.
    if (epoch !== this.epoch) return;
    const { analyzer } = this.deps;

    switch (task) {
      case 'summary': {
        // Parts built from text that has since grown are dropped and rebuilt together with the new lines.
        const stale = this.firstStale('summary');
        const kept = this.summaryParts.filter((part) => part.end <= stale);
        const from = kept.at(-1)?.end ?? 0;
        const { result, parts, chunkSizes } = await analyzer.summarizeMeeting(entries.slice(from), context, kept.map(({ part }) => part));
        if (epoch !== this.epoch) return;
        let start = from;
        const rebuilt = chunkSizes.map((size, index) => {
          const built = { part: parts[kept.length + index], start, end: start + size };
          start += size;
          return built;
        });
        this.summaryParts = [...kept, ...rebuilt];
        this.summary = result.summary;
        this.keyPoints = result.keyPoints;
        this.topics = result.topics;
        this.markAnalyzed('summary', revisions);
        break;
      }
      case 'actions': {
        const items = await analyzer.extractActionItems(entriesSince(entries, this.firstStale('actions'), CHUNK_OVERLAP), context);
        if (epoch !== this.epoch) return;
        for (const item of items) {
          const existing = this.actionItems.find((action) => dedupeKey(action.task) === dedupeKey(item.task));
          if (existing) {
            existing.owner ??= item.owner;
            existing.deadline ??= item.deadline;
            existing.sourceEntryIds = union(existing.sourceEntryIds, item.sources);
          } else {
            this.counters.action += 1;
            this.actionItems.push({ id: `a${this.counters.action}`, task: item.task, owner: item.owner, deadline: item.deadline, sourceEntryIds: item.sources });
          }
        }
        this.markAnalyzed('actions', revisions);
        break;
      }
      case 'decisions': {
        const items = await analyzer.extractDecisions(entriesSince(entries, this.firstStale('decisions'), CHUNK_OVERLAP), context);
        if (epoch !== this.epoch) return;
        for (const item of items) {
          const existing = this.decisions.find((decision) => dedupeKey(decision.decision) === dedupeKey(item.decision));
          if (existing) {
            existing.sourceEntryIds = union(existing.sourceEntryIds, item.sources);
          } else {
            this.counters.decision += 1;
            this.decisions.push({ id: `d${this.counters.decision}`, decision: item.decision, sourceEntryIds: item.sources });
          }
        }
        this.markAnalyzed('decisions', revisions);
        break;
      }
      case 'questions': {
        const items = await analyzer.extractQuestions(entriesSince(entries, this.firstStale('questions'), CHUNK_OVERLAP), context);
        if (epoch !== this.epoch) return;
        for (const item of items) {
          const existing = this.questions.find((question) => dedupeKey(question.question) === dedupeKey(item.question));
          if (existing) {
            if (item.status !== 'unknown') existing.status = item.status;
            existing.sourceEntryIds = union(existing.sourceEntryIds, item.sources);
          } else {
            this.counters.question += 1;
            this.questions.push({ id: `q${this.counters.question}`, question: item.question, status: item.status, sourceEntryIds: item.sources });
          }
        }
        this.markAnalyzed('questions', revisions);
        break;
      }
      case 'email': {
        // The email is written from the analysis, so bring any stale or missing analysis up to date first.
        for (const step of EXTRACTION_ORDER) {
          if (this.firstStale(step) < total) await this.prepare(step, epoch);
          if (epoch !== this.epoch) return;
        }
        const email = await analyzer.writeFollowUpEmail(this.digest(), context);
        if (epoch !== this.epoch) return;
        this.followUpEmail = email;
        break;
      }
    }
  }

  async ask(question: string): Promise<void> {
    const text = question.trim();
    if (!text) return;
    this.counters.qa += 1;
    const item: QAItem = { id: `qa${this.counters.qa}`, question: text, answer: null, error: null, pending: true };
    this.qa.push(item);
    if (this.qa.length > MAX_QA) this.qa.shift();

    if (this.transcript.entries.length === 0) {
      item.pending = false;
      item.error = EMPTY_TRANSCRIPT;
      this.bump();
      return;
    }
    this.bump();

    const epoch = this.epoch;
    await this.enqueue(epoch, async () => {
      try {
        const context = { ...(await this.context()), isCancelled: () => epoch !== this.epoch };
        const answer = await this.deps.analyzer.answerMeetingQuestion(text, [...this.transcript.entries], context, this.digestText());
        if (epoch === this.epoch) item.answer = answer;
      } catch (error) {
        if (epoch === this.epoch) item.error = errorMessage(error);
      } finally {
        if (epoch === this.epoch) {
          item.pending = false;
          this.bump();
        }
      }
    });
  }

  private digest(): MeetingDigest {
    return digestFrom({
      summary: this.summary,
      keyPoints: this.keyPoints,
      topics: this.topics,
      decisions: this.decisions,
      actionItems: this.actionItems,
      questions: this.questions,
    });
  }

  private digestText(): string | undefined {
    const digest = this.digest();
    const hasAnalysis = digest.summary || digest.keyPoints.length || digest.decisions.length || digest.actionItems.length || digest.questions.length;
    return hasAnalysis ? formatDigest(digest) : undefined;
  }

  // --- views ---------------------------------------------------------------------------------

  getTranscriptText(): string {
    return formatTranscript(this.transcript.entries, { startedAt: this.startedAt, meetingCode: this.meetingCode });
  }

  getReport(): MeetReport {
    return {
      generatedAt: this.now(),
      meetingCode: this.meetingCode,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      entries: this.transcript.entries.map((entry) => ({ ...entry })),
      summary: this.summary,
      keyPoints: [...this.keyPoints],
      topics: [...this.topics],
      actionItems: this.actionItems.map((item) => ({ ...item })),
      decisions: this.decisions.map((item) => ({ ...item })),
      questions: this.questions.map((item) => ({ ...item })),
      followUpEmail: this.followUpEmail,
      // Questions that got no answer are noise in a report.
      qa: this.qa.filter((item) => item.answer).map((item) => ({ ...item })),
      analyzed: { ...this.ranOnce },
    };
  }

  getState(): MeetingState {
    return {
      isActive: this.phase === 'active',
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      meetingCode: this.meetingCode,
      entries: this.transcript.entries.map((entry) => ({ ...entry })),
      decisions: this.decisions,
      actionItems: this.actionItems,
      questions: this.questions,
      summary: this.summary,
      keyPoints: this.keyPoints,
      topics: this.topics,
      followUpEmail: this.followUpEmail,
    };
  }

  snapshot(): MeetSnapshot {
    const total = this.transcript.entries.length;
    const pending = (task: ExtractionTask): number => Math.max(0, total - this.firstStale(task));
    return {
      version: this.version,
      page: { ...this.page },
      phase: this.phase,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      entryCount: total,
      recentEntries: this.transcript.recent(RECENT_LIMIT).map((entry) => ({ ...entry })),
      summary: this.summary,
      keyPoints: [...this.keyPoints],
      topics: [...this.topics],
      actionItems: this.actionItems.map((item) => ({ ...item })),
      decisions: this.decisions.map((item) => ({ ...item })),
      questions: this.questions.map((item) => ({ ...item })),
      followUpEmail: this.followUpEmail,
      qa: this.qa.map((item) => ({ ...item })),
      busy: { ...this.busy, ...(this.qa.some((item) => item.pending) ? { ask: true } : {}) },
      errors: { ...this.errors },
      raw: { ...this.raw },
      unanalyzed: { summary: pending('summary'), actions: pending('actions'), decisions: pending('decisions'), questions: pending('questions') },
      analyzed: { ...this.ranOnce },
      ...(this.notice ? { notice: this.notice } : {}),
    };
  }
}
