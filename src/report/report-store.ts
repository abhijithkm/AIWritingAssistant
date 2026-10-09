import type { MeetReport } from '../meet/types';

// One slot. Session storage lives in browser memory only: it is cleared when Chrome closes and is
// not readable by content scripts, so the report never touches disk or a page.
export const REPORT_KEY = 'aiWriterMeetReport';

function sessionArea(): chrome.storage.StorageArea {
  const area = chrome.storage?.session;
  if (!area) throw new Error('This version of Chrome has no session storage, so the report cannot be opened in a new tab.');
  return area;
}

function isMeetReport(value: unknown): value is MeetReport {
  const report = value as Partial<MeetReport> | null;
  return !!report
    && typeof report === 'object'
    && typeof report.generatedAt === 'number'
    && [report.entries, report.keyPoints, report.topics, report.actionItems, report.decisions, report.questions, report.qa].every(Array.isArray);
}

export async function saveReport(report: MeetReport): Promise<void> {
  const area = sessionArea();
  try {
    await area.set({ [REPORT_KEY]: report });
  } catch {
    throw new Error('The report could not be saved. It may be too large for session storage.');
  }
}

export async function loadReport(): Promise<MeetReport | null> {
  const stored = await sessionArea().get(REPORT_KEY);
  const report: unknown = stored[REPORT_KEY];
  return isMeetReport(report) ? report : null;
}

export async function clearReport(): Promise<void> {
  await sessionArea().remove(REPORT_KEY);
}
