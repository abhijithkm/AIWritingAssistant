import type { AIProvider } from '../shared/types';
import { buildSystemPrompt, fence, NOT_FOUND_ANSWER, type PromptContext, type PromptTask } from './prompts';
import type { QuestionStatus, TranscriptEntry } from './types';

export { NOT_FOUND_ANSWER };

export interface SummaryResult {
  summary: string;
  keyPoints: string[];
  topics: string[];
}

export interface ExtractedAction {
  task: string;
  owner?: string;
  deadline?: string;
  sources: string[];
}

export interface ExtractedDecision {
  decision: string;
  sources: string[];
}

export interface ExtractedQuestion {
  question: string;
  status: QuestionStatus;
  sources: string[];
}

// What the follow-up email is written from: the analysis so far, never the raw transcript.
export interface MeetingDigest {
  summary?: string | null;
  keyPoints: string[];
  topics: string[];
  decisions: string[];
  actionItems: Array<{ task: string; owner?: string; deadline?: string }>;
  questions: Array<{ question: string; status?: QuestionStatus }>;
}

export interface AnalyzerLimits {
  chunkMaxChars: number;
  chunkMaxSpanMs: number;
  reduceMaxChars: number;
  qaMaxChars: number;
}

export const DEFAULT_LIMITS: AnalyzerLimits = {
  chunkMaxChars: 9_000,
  chunkMaxSpanMs: 8 * 60_000,
  reduceMaxChars: 12_000,
  qaMaxChars: 9_000,
};

// How many already-analyzed lines to resend with new ones so a chunk keeps its immediate context.
export const CHUNK_OVERLAP = 3;

// Low temperature: these tasks should stay close to the transcript.
const TEMPERATURE = 0.2;
const EMPTY_TRANSCRIPT = 'There is no transcript yet. Wait for captions to appear first.';
const QUESTION_STATUSES: readonly QuestionStatus[] = ['open', 'answered', 'unknown'];
const NO_VALUE = new Set(['', 'null', 'none', 'unknown', 'unassigned', 'n/a', 'na', 'not specified', 'unspecified']);
const STOPWORDS = new Set([
  'the', 'and', 'what', 'who', 'when', 'where', 'why', 'how', 'did', 'does', 'was', 'were', 'are', 'about', 'for', 'with',
  'that', 'this', 'from', 'have', 'has', 'had', 'our', 'you', 'your', 'any', 'all', 'can', 'will', 'would', 'should', 'could',
  'said', 'say', 'tell', 'meeting', 'discussed', 'talk', 'there', 'they', 'them', 'their', 'which', 'into', 'out',
]);

export class MalformedResponseError extends Error {
  constructor(readonly raw: string, detail = 'The AI reply was not in the expected format.') {
    super(detail);
    this.name = 'MalformedResponseError';
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled.');
    this.name = 'CancelledError';
  }
}

// Display names are chosen by participants. Strip anything that could fake a line number or a tag.
const lineSafe = (text: string): string => text.replace(/[\r\n<>[\]]+/g, ' ').replace(/\s+/g, ' ').trim();

export function formatEntry(entry: TranscriptEntry): string {
  const speaker = lineSafe(entry.speaker ?? '') || 'Unknown speaker';
  return `[${entry.id.replace(/^e/, '')}] ${speaker}: ${entry.text.replace(/\s+/g, ' ').trim()}`;
}

const formatLines = (entries: readonly TranscriptEntry[]): string => entries.map(formatEntry).join('\n');
const transcriptText = (entries: readonly TranscriptEntry[]): string => fence('transcript', formatLines(entries));

/** Entries after `cursor`, plus a few before it for context. */
export function entriesSince(entries: readonly TranscriptEntry[], cursor: number, overlap = CHUNK_OVERLAP): TranscriptEntry[] {
  return cursor >= entries.length ? [] : entries.slice(Math.max(0, cursor - overlap));
}

export function chunkEntries(
  entries: readonly TranscriptEntry[],
  limits: { maxChars: number; maxSpanMs: number },
): TranscriptEntry[][] {
  const chunks: TranscriptEntry[][] = [];
  let current: TranscriptEntry[] = [];
  let size = 0;
  let startedAt = 0;
  for (const entry of entries) {
    const cost = formatEntry(entry).length + 1;
    if (current.length > 0 && (size + cost > limits.maxChars || entry.timestamp - startedAt > limits.maxSpanMs)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    if (current.length === 0) startedAt = entry.timestamp;
    current.push(entry);
    size += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// Models wrap JSON in fences or prose. Find the outermost object, but still require it to parse.
export function extractJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const attempts = [text];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) attempts.push(text.slice(start, end + 1));
  for (const attempt of attempts) {
    try {
      const parsed: unknown = JSON.parse(attempt);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

function parseObject(raw: string): Record<string, unknown> {
  const parsed = extractJson(raw);
  if (!parsed) throw new MalformedResponseError(raw);
  return parsed as Record<string, unknown>;
}

function stringArray(value: unknown, raw: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new MalformedResponseError(raw);
  return (value as string[]).map((item) => item.trim()).filter(Boolean);
}

function parseSummary(raw: string): SummaryResult {
  const body = parseObject(raw);
  if (typeof body.summary !== 'string' || !body.summary.trim()) throw new MalformedResponseError(raw);
  return { summary: body.summary.trim(), keyPoints: stringArray(body.keyPoints, raw), topics: stringArray(body.topics, raw) };
}

function listOf(raw: string, field: string): unknown[] {
  const list = parseObject(raw)[field];
  if (!Array.isArray(list)) throw new MalformedResponseError(raw);
  return list;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return NO_VALUE.has(text.toLowerCase()) ? undefined : text;
}

function requiredText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// Models cite "12", 12 or "e12"; only ids that exist in this transcript are kept.
function parseSources(value: unknown, ids: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return [];
  const found = value
    .map((item) => /\d+/.exec(String(item))?.[0])
    .filter((digits): digits is string => digits !== undefined)
    .map((digits) => `e${Number(digits)}`)
    .filter((id) => ids.has(id));
  return [...new Set(found)];
}

const records = (list: unknown[]): Array<Record<string, unknown>> =>
  list.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');

function parseActions(raw: string, ids: ReadonlySet<string>): ExtractedAction[] {
  return records(listOf(raw, 'actionItems')).flatMap((item) => {
    const task = requiredText(item.task);
    return task ? [{ task, owner: optionalText(item.owner), deadline: optionalText(item.deadline), sources: parseSources(item.sources, ids) }] : [];
  });
}

function parseDecisions(raw: string, ids: ReadonlySet<string>): ExtractedDecision[] {
  return records(listOf(raw, 'decisions')).flatMap((item) => {
    const decision = requiredText(item.decision);
    return decision ? [{ decision, sources: parseSources(item.sources, ids) }] : [];
  });
}

function parseQuestions(raw: string, ids: ReadonlySet<string>): ExtractedQuestion[] {
  return records(listOf(raw, 'questions')).flatMap((item) => {
    const question = requiredText(item.question);
    if (!question) return [];
    const status = QUESTION_STATUSES.find((candidate) => candidate === item.status) ?? 'unknown';
    return [{ question, status, sources: parseSources(item.sources, ids) }];
  });
}

export const dedupeKey = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

function keywords(question: string): string[] {
  const words = question.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3 && !STOPWORDS.has(word));
  return [...new Set(words.flatMap((word) => (word.length > 4 && word.endsWith('s') ? [word, word.slice(0, -1)] : [word])))];
}

/** The transcript lines to send for a question: everything if it fits, else relevant and recent lines. */
export function selectQaContext(
  question: string,
  entries: readonly TranscriptEntry[],
  maxChars: number,
): { entries: TranscriptEntry[]; total: number } {
  const lines = entries.map(formatEntry);
  const size = lines.reduce((sum, line) => sum + line.length + 1, 0);
  if (size <= maxChars) return { entries: [...entries], total: entries.length };

  const terms = keywords(question);
  const scores = entries.map((entry) => {
    const text = entry.text.toLowerCase();
    return terms.filter((term) => text.includes(term)).length;
  });
  const chosen = new Set<number>();
  let used = 0;
  const take = (index: number): boolean => {
    if (index < 0 || index >= entries.length || chosen.has(index)) return true;
    const cost = lines[index].length + 1;
    if (used + cost > maxChars) return false;
    chosen.add(index);
    used += cost;
    return true;
  };

  const relevant = scores.flatMap((score, index) => (score > 0 ? [index] : [])).sort((a, b) => scores[b] - scores[a] || b - a);
  for (const index of relevant) {
    if (used >= maxChars * 0.6) break;
    take(index);
    take(index - 1);
    take(index + 1);
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (!take(index)) break;
  }
  return { entries: [...chosen].sort((a, b) => a - b).map((index) => entries[index]), total: entries.length };
}

function batchBySize<T>(items: T[], maxChars: number): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const item of items) {
    const cost = JSON.stringify(item).length;
    // At least two per batch, so repeated combining always makes progress.
    if (current.length >= 2 && size + cost > maxChars) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += cost;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** The analysis in the shape the email and Q&A prompts expect. */
export function digestFrom(analysis: {
  summary: string | null;
  keyPoints: string[];
  topics: string[];
  decisions: Array<{ decision: string }>;
  actionItems: Array<{ task: string; owner?: string; deadline?: string }>;
  questions: Array<{ question: string; status?: QuestionStatus }>;
}): MeetingDigest {
  return {
    summary: analysis.summary,
    keyPoints: analysis.keyPoints,
    topics: analysis.topics,
    decisions: analysis.decisions.map(({ decision }) => decision),
    actionItems: analysis.actionItems.map(({ task, owner, deadline }) => ({ task, owner, deadline })),
    questions: analysis.questions.map(({ question, status }) => ({ question, status })),
  };
}

export function formatDigest(digest: MeetingDigest): string {
  const bullets = (items: string[]): string => (items.length ? items.map((item) => `- ${item}`).join('\n') : '- (none)');
  const actions = digest.actionItems.map(({ task, owner, deadline }) => `${task}${owner ? ` (Owner: ${owner})` : ''}${deadline ? ` (Due: ${deadline})` : ''}`);
  const questions = digest.questions.map(({ question, status }) => `${question}${status && status !== 'unknown' ? ` [${status}]` : ''}`);
  return [
    `Topics: ${digest.topics.length ? digest.topics.join('; ') : '(not identified)'}`,
    `Summary: ${digest.summary?.trim() || '(none)'}`,
    `Key points:\n${bullets(digest.keyPoints)}`,
    `Decisions:\n${bullets(digest.decisions)}`,
    `Action items:\n${bullets(actions)}`,
    `Open questions and issues:\n${bullets(questions)}`,
  ].join('\n\n');
}

export interface AnalyzerContext extends PromptContext {
  // Checked before every request, so a stopped session sends no further requests.
  isCancelled?: () => boolean;
}

/** Meeting-specific AI calls. Every method sends only the text it is given and never loops on its own. */
export class MeetingAnalyzer {
  private readonly limits: AnalyzerLimits;

  constructor(private readonly provider: AIProvider, limits: Partial<AnalyzerLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  private async ask(task: PromptTask, text: string, context: AnalyzerContext): Promise<string> {
    if (context.isCancelled?.()) throw new CancelledError();
    const { text: reply } = await this.provider.generate({ text, system: buildSystemPrompt(task, context), temperature: TEMPERATURE });
    return reply;
  }

  private chunks(entries: readonly TranscriptEntry[]): TranscriptEntry[][] {
    return chunkEntries(entries, { maxChars: this.limits.chunkMaxChars, maxSpanMs: this.limits.chunkMaxSpanMs });
  }

  /**
   * Summarizes `entries` chunk by chunk and combines the result with `priorParts` (summaries of
   * earlier chunks), so repeat calls only send transcript lines that are new.
   */
  async summarizeMeeting(
    entries: readonly TranscriptEntry[],
    context: AnalyzerContext,
    priorParts: SummaryResult[] = [],
  ): Promise<{ result: SummaryResult; parts: SummaryResult[]; chunkSizes: number[] }> {
    if (entries.length === 0 && priorParts.length === 0) throw new Error(EMPTY_TRANSCRIPT);
    const parts = [...priorParts];
    const chunks = this.chunks(entries);
    for (const chunk of chunks) {
      parts.push(parseSummary(await this.ask('summary', transcriptText(chunk), context)));
    }
    let level = parts;
    while (level.length > 1) {
      const next: SummaryResult[] = [];
      for (const batch of batchBySize(level, this.limits.reduceMaxChars)) {
        next.push(batch.length === 1
          ? batch[0]
          : parseSummary(await this.ask('combineSummaries', fence('partial_summaries', JSON.stringify({ parts: batch })), context)));
      }
      level = next;
    }
    // `chunkSizes` says how many entries each new part covers, so callers can tell which part a later edit invalidates.
    return { result: level[0], parts, chunkSizes: chunks.map((chunk) => chunk.length) };
  }

  private async extract<T extends { sources: string[] }>(
    task: 'actions' | 'decisions' | 'questions',
    entries: readonly TranscriptEntry[],
    context: AnalyzerContext,
    parse: (raw: string, ids: ReadonlySet<string>) => T[],
    label: (item: T) => string,
    combine: (existing: T, incoming: T) => T,
  ): Promise<T[]> {
    if (entries.length === 0) throw new Error(EMPTY_TRANSCRIPT);
    const ids = new Set(entries.map((entry) => entry.id));
    const merged = new Map<string, T>();
    for (const chunk of this.chunks(entries)) {
      for (const item of parse(await this.ask(task, transcriptText(chunk), context), ids)) {
        const key = dedupeKey(label(item));
        const existing = merged.get(key);
        merged.set(key, existing ? combine(existing, item) : item);
      }
    }
    return [...merged.values()];
  }

  extractActionItems(entries: readonly TranscriptEntry[], context: AnalyzerContext): Promise<ExtractedAction[]> {
    return this.extract('actions', entries, context, parseActions, (item) => item.task, (a, b) => ({
      task: a.task,
      owner: a.owner ?? b.owner,
      deadline: a.deadline ?? b.deadline,
      sources: [...new Set([...a.sources, ...b.sources])],
    }));
  }

  extractDecisions(entries: readonly TranscriptEntry[], context: AnalyzerContext): Promise<ExtractedDecision[]> {
    return this.extract('decisions', entries, context, parseDecisions, (item) => item.decision, (a, b) => ({
      decision: a.decision,
      sources: [...new Set([...a.sources, ...b.sources])],
    }));
  }

  extractQuestions(entries: readonly TranscriptEntry[], context: AnalyzerContext): Promise<ExtractedQuestion[]> {
    return this.extract('questions', entries, context, parseQuestions, (item) => item.question, (a, b) => ({
      question: a.question,
      status: b.status !== 'unknown' ? b.status : a.status,
      sources: [...new Set([...a.sources, ...b.sources])],
    }));
  }

  async answerMeetingQuestion(
    question: string,
    entries: readonly TranscriptEntry[],
    context: AnalyzerContext,
    digest?: string,
  ): Promise<string> {
    const trimmed = question.trim();
    if (!trimmed) throw new Error('Type a question about the meeting first.');
    if (entries.length === 0) throw new Error(EMPTY_TRANSCRIPT);
    const selected = selectQaContext(trimmed, entries, this.limits.qaMaxChars);
    const header = selected.entries.length < selected.total
      ? `Transcript excerpt (${selected.entries.length} of ${selected.total} lines, chosen for relevance to the question and recency):`
      : 'Transcript:';
    const text = [
      `Question: ${trimmed}`,
      digest ? `Analysis notes (machine-generated, may be incomplete):\n${fence('notes', digest)}` : '',
      `${header}\n${transcriptText(selected.entries)}`,
    ].filter(Boolean).join('\n\n');
    return (await this.ask('answer', text, context)).trim();
  }

  async writeFollowUpEmail(digest: MeetingDigest, context: AnalyzerContext): Promise<string> {
    const email = (await this.ask('email', fence('notes', formatDigest(digest)), context)).trim();
    if (/^subject:/i.test(email)) return email;
    // The model skipped the subject line: add one without inventing a topic.
    return `Subject: Follow-up — ${digest.topics[0] ?? 'Meeting'}\n\n${email}`;
  }
}
