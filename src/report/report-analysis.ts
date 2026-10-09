import { digestFrom, MalformedResponseError, type MeetingAnalyzer } from '../meet/meeting-analyzer';
import type { ExtractionTask, MeetReport } from '../meet/types';
import { USER_NAME_KEY } from '../shared/types';

export type ReportSection = ExtractionTask | 'email';

export const ANALYSIS_SECTIONS: readonly ExtractionTask[] = ['summary', 'actions', 'decisions', 'questions'];

export interface SectionDeps {
  analyzer: MeetingAnalyzer;
  userName?: string;
  // Called after every finished step, so work that succeeded before a later step failed is kept.
  commit: (report: MeetReport) => void;
}

const MALFORMED = 'The AI reply was not in the expected format. Please retry.';

function isDone(report: MeetReport, section: ExtractionTask): boolean {
  if (section === 'summary') return report.summary !== null;
  const found = { actions: report.actionItems, decisions: report.decisions, questions: report.questions }[section];
  return report.analyzed[section] || found.length > 0;
}

/** The analyses the report does not have yet. */
export function missingSections(report: MeetReport): ExtractionTask[] {
  return ANALYSIS_SECTIONS.filter((section) => !isDone(report, section));
}

export const isSectionDone = isDone;

// Only the display name is read, never the settings object that holds the API key.
export async function readUserName(): Promise<string | undefined> {
  try {
    const stored = await chrome.storage.local.get(USER_NAME_KEY);
    const name: unknown = stored[USER_NAME_KEY];
    return typeof name === 'string' && name.trim() ? name.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Generates one section of the report from its stored transcript. The email first fills in any missing analysis. */
export async function runSection(report: MeetReport, section: ReportSection, deps: SectionDeps): Promise<MeetReport> {
  const { analyzer, commit } = deps;
  const context = { userName: deps.userName };
  try {
    if (section === 'email') {
      let current = report;
      for (const step of missingSections(report)) current = await runSection(current, step, deps);
      const followUpEmail = await analyzer.writeFollowUpEmail(digestFrom(current), context);
      const done = { ...current, followUpEmail };
      commit(done);
      return done;
    }

    let next: MeetReport;
    switch (section) {
      case 'summary': {
        const { result } = await analyzer.summarizeMeeting(report.entries, context);
        next = { ...report, summary: result.summary, keyPoints: result.keyPoints, topics: result.topics };
        break;
      }
      case 'actions': {
        const items = await analyzer.extractActionItems(report.entries, context);
        next = { ...report, actionItems: items.map((item, index) => ({ id: `a${index + 1}`, task: item.task, owner: item.owner, deadline: item.deadline, sourceEntryIds: item.sources })) };
        break;
      }
      case 'decisions': {
        const items = await analyzer.extractDecisions(report.entries, context);
        next = { ...report, decisions: items.map((item, index) => ({ id: `d${index + 1}`, decision: item.decision, sourceEntryIds: item.sources })) };
        break;
      }
      case 'questions': {
        const items = await analyzer.extractQuestions(report.entries, context);
        next = { ...report, questions: items.map((item, index) => ({ id: `q${index + 1}`, question: item.question, status: item.status, sourceEntryIds: item.sources })) };
        break;
      }
    }
    next = { ...next, analyzed: { ...next.analyzed, [section]: true } };
    commit(next);
    return next;
  } catch (error) {
    if (error instanceof MalformedResponseError) throw new Error(MALFORMED);
    throw error;
  }
}
