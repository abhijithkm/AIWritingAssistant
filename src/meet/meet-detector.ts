import { MEET_SELECTORS, selectorList, type MeetSelectors } from './selectors';
import type { CaptionsStatus, MeetPageStatus } from './types';

export const MEET_HOSTNAME = 'meet.google.com';

const MEETING_PATH = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/;
const NAVIGATION_POLL_MS = 1_000;

export function isMeetHost(hostname: string = window.location.hostname): boolean {
  return hostname === MEET_HOSTNAME;
}

// Meet is a single-page app: only paths shaped like abc-defg-hij are meetings (not /landing, /new, ...).
export function getMeetingCode(pathname: string = window.location.pathname): string | null {
  return MEETING_PATH.exec(pathname)?.[1] ?? null;
}

export interface CaptionContainerMatch {
  element: Element;
}

// Tries selectors in priority order. A combined selector would return whichever match comes first in
// the document, which can be an outer wrapper instead of the best (most semantic) match.
function firstMatch(doc: Document, list: readonly string[]): Element | null {
  for (const selector of list) {
    const match = doc.querySelector(selector);
    if (match) return match;
  }
  return null;
}

export function findCaptionContainer(doc: Document = document, selectors: MeetSelectors = MEET_SELECTORS): CaptionContainerMatch | null {
  const element = firstMatch(doc, selectors.captionContainer);
  return element ? { element } : null;
}

function captionsFromToggle(doc: Document, selectors: MeetSelectors): CaptionsStatus {
  for (const toggle of doc.querySelectorAll(selectorList(selectors.captionToggle))) {
    const pressed = toggle.getAttribute('aria-pressed');
    if (pressed === 'true') return 'on';
    if (pressed === 'false') return 'off';
    // The label names the action, so "Turn on captions" means captions are currently off.
    const label = (toggle.getAttribute('aria-label') ?? toggle.getAttribute('data-tooltip') ?? '').toLowerCase();
    if (/turn off captions|hide captions/.test(label)) return 'on';
    if (/turn on captions|show captions/.test(label)) return 'off';
  }
  return 'unknown';
}

export function detectMeetPage(
  doc: Document = document,
  pathname: string = window.location.pathname,
  selectors: MeetSelectors = MEET_SELECTORS,
): MeetPageStatus {
  const meetingCode = getMeetingCode(pathname);
  const captions: CaptionsStatus = findCaptionContainer(doc, selectors) ? 'on' : captionsFromToggle(doc, selectors);
  return { meetingDetected: meetingCode !== null, meetingCode, captions };
}

/**
 * Calls `onChange` whenever the page URL changes. Meet navigates with pushState, which fires no
 * event the isolated content script can see, so a light poll backs up popstate and the Navigation API.
 */
export function watchNavigation(onChange: (url: string) => void, win: Window = window): () => void {
  let last = win.location.href;
  const check = (): void => {
    const href = win.location.href;
    if (href === last) return;
    last = href;
    onChange(href);
  };
  const navigation = (win as unknown as { navigation?: EventTarget }).navigation;
  win.addEventListener('popstate', check);
  win.addEventListener('hashchange', check);
  navigation?.addEventListener('navigatesuccess', check);
  const timer = setInterval(check, NAVIGATION_POLL_MS);
  return () => {
    win.removeEventListener('popstate', check);
    win.removeEventListener('hashchange', check);
    navigation?.removeEventListener('navigatesuccess', check);
    clearInterval(timer);
  };
}
