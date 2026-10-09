import { MEET_SELECTORS, selectorList, type MeetSelectors } from './selectors';
import { normalizeText } from './text-utils';

export interface ParsedCaption {
  speaker?: string;
  text: string;
}

export interface CaptionBlockReading extends ParsedCaption {
  element: Element;
}

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'BR']);
const MAX_SPEAKER_LENGTH = 60;
const MAX_DESCENT = 6;

function visibleText(element: Element, selectors: MeetSelectors): string {
  let out = '';
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.matches(selectors.ignored)) return;
    el.childNodes.forEach(walk);
    if (BLOCK_TAGS.has(el.tagName)) out += ' ';
  };
  element.childNodes.forEach(walk);
  return normalizeText(out);
}

function textChildren(element: Element, selectors: MeetSelectors): Element[] {
  return Array.from(element.children).filter((child) => !child.matches(selectors.ignored) && visibleText(child, selectors) !== '');
}

function cleanSpeaker(raw: string): string | undefined {
  const name = normalizeText(raw).replace(/\s*:\s*$/, '');
  return name && name.length <= MAX_SPEAKER_LENGTH ? name : undefined;
}

// A block splits into a leading name element and the caption text elements that follow it.
function splitBlock(block: Element, selectors: MeetSelectors): { speakerEl?: Element; textEls: Element[] } {
  let node = block;
  for (let depth = 0; depth < MAX_DESCENT; depth += 1) {
    const kids = textChildren(node, selectors);
    if (kids.length >= 2) {
      const [first, ...rest] = kids;
      if (cleanSpeaker(visibleText(first, selectors))) return { speakerEl: first, textEls: rest };
      return { textEls: kids };
    }
    if (kids.length === 0) break;
    node = kids[0];
  }
  return { textEls: [node] };
}

function isStructured(element: Element, selectors: MeetSelectors): boolean {
  return splitBlock(element, selectors).speakerEl !== undefined;
}

// In priority order: a combined selector would return an outer element (such as the name header)
// ahead of the more specific name element inside it.
function firstMatch(root: Element, list: readonly string[]): Element | null {
  for (const selector of list) {
    const match = root.querySelector(selector);
    if (match) return match;
  }
  return null;
}

export function parseCaptionBlock(block: Element, selectors: MeetSelectors = MEET_SELECTORS): ParsedCaption | null {
  const configuredText = firstMatch(block, selectors.captionText);
  if (configuredText) {
    const text = visibleText(configuredText, selectors);
    if (!text) return null;
    const nameEl = firstMatch(block, selectors.speakerName);
    const speaker = nameEl && !configuredText.contains(nameEl) ? cleanSpeaker(visibleText(nameEl, selectors)) : undefined;
    return { speaker, text };
  }

  const { speakerEl, textEls } = splitBlock(block, selectors);
  const text = normalizeText(textEls.map((el) => visibleText(el, selectors)).join(' '));
  if (!text) return null;
  return { speaker: speakerEl ? cleanSpeaker(visibleText(speakerEl, selectors)) : undefined, text };
}

function outermost(elements: Element[]): Element[] {
  return elements.filter((el) => !elements.some((other) => other !== el && other.contains(el)));
}

// Without known block classes, infer blocks from shape: wrappers hold one child, sibling blocks each hold name + text.
function structuralBlocks(container: Element, selectors: MeetSelectors): Element[] {
  let node = container;
  for (let depth = 0; depth < MAX_DESCENT; depth += 1) {
    const kids = textChildren(node, selectors);
    if (kids.length === 0) return [];
    if (kids.length === 1) {
      const only = kids[0];
      const inner = textChildren(only, selectors);
      if (inner.length === 0) return [only];
      if (inner.length >= 2 && !inner.every((el) => isStructured(el, selectors))) return [only];
      node = only;
      continue;
    }
    return kids.every((el) => isStructured(el, selectors)) ? kids : [node];
  }
  return [];
}

export function findCaptionBlocks(container: Element, selectors: MeetSelectors = MEET_SELECTORS): Element[] {
  const configured = outermost(Array.from(container.querySelectorAll(selectorList(selectors.captionBlock))));
  return configured.length > 0 ? configured : structuralBlocks(container, selectors);
}

export function readCaptionBlocks(container: Element, selectors: MeetSelectors = MEET_SELECTORS): CaptionBlockReading[] {
  const readings: CaptionBlockReading[] = [];
  for (const element of findCaptionBlocks(container, selectors)) {
    const parsed = parseCaptionBlock(element, selectors);
    if (parsed) readings.push({ element, ...parsed });
  }
  return readings;
}
