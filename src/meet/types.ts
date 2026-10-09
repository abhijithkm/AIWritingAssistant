export interface TranscriptEntry {
  id: string;
  speaker?: string;
  text: string;
  timestamp: number;
}

export interface ActionItem {
  id: string;
  task: string;
  owner?: string;
  deadline?: string;
  sourceEntryIds: string[];
}

export interface Decision {
  id: string;
  decision: string;
  sourceEntryIds: string[];
}

export type QuestionStatus = 'open' | 'answered' | 'unknown';

export interface Question {
  id: string;
  question: string;
  status?: QuestionStatus;
  sourceEntryIds: string[];
}

export interface MeetingState {
  isActive: boolean;
  startedAt: number | null;
  endedAt: number | null;
  meetingCode: string | null;
  entries: TranscriptEntry[];
  decisions: Decision[];
  actionItems: ActionItem[];
  questions: Question[];
  summary: string | null;
  keyPoints: string[];
  topics: string[];
  followUpEmail: string | null;
}

// Tasks that call the AI. Each is started by an explicit user action, never by incoming captions.
export type AnalysisTask = 'summary' | 'actions' | 'decisions' | 'questions' | 'email';
export type ExtractionTask = Exclude<AnalysisTask, 'email'>;

export interface QAItem {
  id: string;
  question: string;
  answer: string | null;
  error: string | null;
  pending: boolean;
}

export type CaptionsStatus = 'on' | 'off' | 'unknown';

export interface MeetPageStatus {
  meetingDetected: boolean;
  meetingCode: string | null;
  captions: CaptionsStatus;
}

// One settled caption block. `key` is stable while the same DOM block keeps growing.
export interface CaptionEvent {
  key: number;
  speaker?: string;
  text: string;
  timestamp: number;
}

// Everything about a finished meeting, for the full-page report. Unlike a snapshot it carries every
// transcript line. It is handed to the report page through memory-only session storage.
export interface MeetReport {
  generatedAt: number;
  meetingCode: string | null;
  startedAt: number | null;
  endedAt: number | null;
  entries: TranscriptEntry[];
  summary: string | null;
  keyPoints: string[];
  topics: string[];
  actionItems: ActionItem[];
  decisions: Decision[];
  questions: Question[];
  followUpEmail: string | null;
  qa: QAItem[];
  // Which analyses have run at least once, so "found nothing" is told apart from "not run yet".
  analyzed: Record<ExtractionTask, boolean>;
}

export type MeetPhase = 'idle' | 'active' | 'stopped';

export interface MeetSnapshot {
  version: number;
  page: MeetPageStatus;
  phase: MeetPhase;
  startedAt: number | null;
  endedAt: number | null;
  entryCount: number;
  // Only the newest entries are sent to the popup so long meetings stay cheap to render.
  recentEntries: TranscriptEntry[];
  summary: string | null;
  keyPoints: string[];
  topics: string[];
  actionItems: ActionItem[];
  decisions: Decision[];
  questions: Question[];
  followUpEmail: string | null;
  qa: QAItem[];
  busy: Partial<Record<AnalysisTask | 'ask', boolean>>;
  errors: Partial<Record<AnalysisTask, string>>;
  // Unparseable AI replies, shown as-is so the user still sees what the model said.
  raw: Partial<Record<ExtractionTask, string>>;
  // Transcript lines that are new or have grown since each analysis last ran.
  unanalyzed: Record<ExtractionTask, number>;
  // Whether each analysis has completed at least once ("nothing found" versus "not run yet").
  analyzed: Record<ExtractionTask, boolean>;
  notice?: string;
}

export type MeetCommand =
  | { type: 'MEET_GET_STATE'; sinceVersion?: number }
  | { type: 'MEET_START' }
  | { type: 'MEET_STOP' }
  | { type: 'MEET_DISCARD' }
  | { type: 'MEET_ANALYZE'; task: AnalysisTask }
  | { type: 'MEET_ASK'; question: string }
  | { type: 'MEET_GET_TRANSCRIPT' }
  | { type: 'MEET_GET_REPORT' }
  | { type: 'MEET_DEBUG_DUMP' };

export type MeetReply =
  | { ok: true; snapshot: MeetSnapshot }
  | { ok: true; unchanged: true; version: number }
  | { ok: true; text: string }
  | { ok: true; report: MeetReport }
  | { ok: false; error: string };

export const MEET_COMMAND_TYPES = [
  'MEET_GET_STATE', 'MEET_START', 'MEET_STOP', 'MEET_DISCARD', 'MEET_ANALYZE', 'MEET_ASK',
  'MEET_GET_TRANSCRIPT', 'MEET_GET_REPORT', 'MEET_DEBUG_DUMP',
] as const;
