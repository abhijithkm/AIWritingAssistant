/**
 * Every Google Meet DOM selector lives here. Meet ships obfuscated class names that change without
 * notice, so the lists run from semantic hooks (roles, labels) to class names, and the parser falls
 * back to DOM structure when none match. Update this file first when captions break.
 *
 * Verified against a live Meet call and Meet's own stylesheet and templates on 2026-10-09:
 * - the captions region is div[role="region"][aria-label="Captions"].vNKgIf (inside div[jsname="dsyhDe"])
 *   and exists as soon as captions are on, even before anyone speaks
 * - each speaker is div.nMcdL: a div.adE6rb header (avatar img + div.KcIKyf > span.NWpY1d name),
 *   then div.ygicle with the caption text
 * - the CC button is button[aria-label="Turn on captions" | "Turn off captions"] with no aria-pressed
 * Not verified live: speaker blocks with real speech (no audio reached Meet during the check).
 */
export const MEET_SELECTORS = {
  // The caption overlay, in priority order. There is deliberately no generic fallback such as "any
  // region": the assistant would then read other panels (chat, people) as if they were captions.
  captionContainer: [
    '[role="region"][aria-label*="aption" i]',
    '.vNKgIf',
    '[jsname="dsyhDe"]',
    '.a4cQT',
  ],
  // One speaker's caption (name plus text). Optional: the parser infers blocks when absent.
  captionBlock: [
    '.nMcdL',
  ],
  speakerName: [
    '.NWpY1d',
    '.KcIKyf',
    '.adE6rb',
  ],
  captionText: [
    '.ygicle',
    '.VbkSUe',
  ],
  // The in-call "captions" toggle, used to tell "captions off" from "nobody has spoken yet".
  captionToggle: [
    'button[aria-label*="captions" i]',
    'button[data-tooltip*="captions" i]',
    '[role="button"][aria-label*="captions" i]',
  ],
  // Interface chrome whose text must never count as caption text.
  ignored: 'button, [role="button"], script, style, svg',
} as const;

export type MeetSelectors = typeof MEET_SELECTORS;

export function selectorList(selectors: readonly string[]): string {
  return selectors.join(',');
}
