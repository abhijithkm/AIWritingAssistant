import { detectMeetPage, findCaptionContainer } from './meet-detector';
import { MEET_SELECTORS, selectorList, type MeetSelectors } from './selectors';

const MAX_NODES = 150;
const MAX_DEPTH = 8;
// Structure and styling hooks only. Ids, names, image sources and other values can identify people.
const KEPT_ATTRIBUTES = ['role', 'aria-label', 'tabindex', 'jsname', 'aria-live', 'aria-pressed', 'class'];
// aria-labels can carry participant names, so only labels known to be Meet's own interface text are kept.
const KNOWN_LABEL = /^(captions?|jump to (most recent captions|bottom)|turn (on|off) captions( \(c\))?)$/i;

const labelValue = (value: string): string => (KNOWN_LABEL.test(value) ? value : `[redacted, ${value.length} chars]`);

function openingTag(el: Element): string {
  const attrs = el.tagName === 'IMG' ? [] : KEPT_ATTRIBUTES.flatMap((name) => {
    const value = el.getAttribute(name);
    if (value === null) return [];
    return [`${name}="${name === 'aria-label' ? labelValue(value) : value}"`];
  });
  return `<${el.tagName.toLowerCase()}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`;
}

function ownTextLength(el: Element): number {
  return Array.from(el.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .reduce((sum, node) => sum + (node.textContent ?? '').trim().length, 0);
}

function describeTree(root: Element): string[] {
  const lines: string[] = [];
  let nodes = 0;
  const visit = (el: Element, depth: number): void => {
    if (nodes >= MAX_NODES) return;
    nodes += 1;
    const text = ownTextLength(el);
    lines.push(`${'  '.repeat(depth)}${openingTag(el)}${text ? ` ⟨${text} chars⟩` : ''}`);
    if (depth >= MAX_DEPTH) return;
    for (const child of el.children) visit(child, depth + 1);
  };
  visit(root, 0);
  const total = root.querySelectorAll('*').length + 1;
  if (total > nodes) lines.push(`… ${total - nodes} more elements omitted`);
  return lines;
}

/**
 * A redacted description of Meet's caption DOM. Meet changes its markup without notice; sharing
 * this report shows what the selectors in selectors.ts need to match, without any meeting content.
 */
export function describeCaptionDom(
  doc: Document = document,
  pathname: string = window.location.pathname,
  selectors: MeetSelectors = MEET_SELECTORS,
): string {
  const page = detectMeetPage(doc, pathname, selectors);
  const found = findCaptionContainer(doc, selectors);
  const lines = [
    'AI Writer — Meet caption DOM report (text, names and ids are redacted)',
    `page: ${pathname.replace(/[a-z]{3}-[a-z]{4}-[a-z]{3}/g, 'xxx-xxxx-xxx')}`,
    `captions: ${page.captions}`,
  ];

  if (found) {
    const matched = selectors.captionContainer.find((selector) => doc.querySelector(selector) === found.element);
    lines.push(`container: found${matched ? ` (${matched})` : ''}`);
  } else {
    lines.push('container: none found');
  }

  const toggle = doc.querySelector(selectorList(selectors.captionToggle));
  lines.push(`toggle: ${toggle ? openingTag(toggle).replace(/ (class|tabindex|jsname|role)="[^"]*"/g, '') : 'none found'}`);

  if (found) lines.push('tree:', ...describeTree(found.element));
  return lines.join('\n');
}
