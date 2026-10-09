import { findCaptionContainer } from './meet-detector';
import { MEET_SELECTORS, type MeetSelectors } from './selectors';
import { readCaptionBlocks } from './speaker-parser';
import { mergeGrowth } from './text-utils';
import type { CaptionEvent } from './types';

export interface ObserverStatus {
  containerFound: boolean;
}

export interface CaptionObserverOptions {
  onCaption: (caption: CaptionEvent) => void;
  onStatus?: (status: ObserverStatus) => void;
  doc?: Document;
  selectors?: MeetSelectors;
  // Emit a block once its text has not changed for this long...
  settleMs?: number;
  // ...or at least this often while it keeps changing, so words that scroll off are not lost.
  maxHoldMs?: number;
  scanMs?: number;
  now?: () => number;
}

interface BlockState {
  key: number;
  speaker?: string;
  text: string;
  firstSeen: number;
  lastChange: number;
  dirtySince: number | null;
  emittedText: string | null;
}

const READ_THROTTLE_MS = 50;
// Meet sometimes rewrites its first guess for a caption completely ("Help. And. He" became a different
// sentence). A draft this short that was replaced before it settled is a revision, not something said.
const DRAFT_MAX_WORDS = 4;
// A re-rendered block can reappear in a new element shortly after the old one vanishes.
const ADOPT_WINDOW_MS = 5_000;

/**
 * Watches Meet's visible captions and emits each caption block once it has settled. It never emits
 * per-mutation: Meet rewrites a block word by word, so emitting early would flood the transcript.
 */
export class CaptionObserver {
  private readonly doc: Document;
  private readonly selectors: MeetSelectors;
  private readonly settleMs: number;
  private readonly maxHoldMs: number;
  private readonly scanMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readTimer: ReturnType<typeof setTimeout> | null = null;
  private mutations: MutationObserver | null = null;
  private container: Element | null = null;
  private blocks = new Map<Element, BlockState>();
  private removed: Array<{ state: BlockState; at: number }> = [];
  private nextKey = 0;
  private lastStatus: ObserverStatus | null = null;

  constructor(private readonly options: CaptionObserverOptions) {
    this.doc = options.doc ?? document;
    this.selectors = options.selectors ?? MEET_SELECTORS;
    this.settleMs = options.settleMs ?? 1_200;
    this.maxHoldMs = options.maxHoldMs ?? 3_000;
    this.scanMs = options.scanMs ?? 400;
  }

  get running(): boolean { return this.timer !== null; }
  get containerElement(): Element | null { return this.container; }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.scanMs);
    this.tick();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    if (this.readTimer) clearTimeout(this.readTimer);
    this.readTimer = null;
    this.detach();
    this.removed = [];
    this.lastStatus = null;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private tick(): void {
    this.scanContainer();
    this.readBlocks();
    this.flushDue();
  }

  private scanContainer(): void {
    const found = findCaptionContainer(this.doc, this.selectors);
    const element = found?.element ?? null;
    if (element !== this.container) {
      this.detach();
      this.container = element;
      if (element) {
        this.mutations = new MutationObserver(() => this.scheduleRead());
        this.mutations.observe(element, { childList: true, subtree: true, characterData: true });
      }
    }
    const status = { containerFound: element !== null };
    if (!this.lastStatus || this.lastStatus.containerFound !== status.containerFound) {
      this.lastStatus = status;
      this.options.onStatus?.(status);
    }
  }

  private detach(): void {
    this.mutations?.disconnect();
    this.mutations = null;
    const at = this.now();
    for (const state of this.blocks.values()) {
      this.emit(state);
      this.removed.push({ state, at });
    }
    this.blocks.clear();
    this.container = null;
  }

  private scheduleRead(): void {
    if (this.readTimer || !this.timer) return;
    this.readTimer = setTimeout(() => {
      this.readTimer = null;
      this.readBlocks();
    }, READ_THROTTLE_MS);
  }

  private readBlocks(): void {
    if (!this.container) return;
    const now = this.now();
    this.removed = this.removed.filter((entry) => now - entry.at <= ADOPT_WINDOW_MS);

    const readings = readCaptionBlocks(this.container, this.selectors);
    const present = new Set(readings.map((reading) => reading.element));

    const gone: BlockState[] = [];
    for (const [element, state] of this.blocks) {
      if (!present.has(element)) {
        gone.push(state);
        this.blocks.delete(element);
      }
    }
    const candidates = [...gone.map((state) => ({ state, at: now })), ...this.removed];
    const adopted = new Set<BlockState>();

    for (const { element, speaker, text } of readings) {
      const state = this.blocks.get(element);
      if (!state) {
        let previous: BlockState | undefined;
        let joined = text;
        for (const candidate of candidates) {
          if (adopted.has(candidate.state) || candidate.state.speaker !== speaker) continue;
          const merged = mergeGrowth(candidate.state.text, text, { fuzzy: true });
          if (merged === null) continue;
          previous = candidate.state;
          joined = merged;
          break;
        }
        if (previous) adopted.add(previous);
        this.blocks.set(element, this.adoptOrCreate(previous, speaker, joined, now));
        continue;
      }
      // Keep the merged text, not just what is on screen: Meet slides older words off the front of a
      // long caption, and those words must survive until the block is emitted.
      const merged = state.speaker === speaker ? mergeGrowth(state.text, text, { fuzzy: true }) : null;
      if (merged !== null) {
        if (merged !== state.text) {
          state.text = merged;
          state.lastChange = now;
          state.dirtySince ??= now;
        }
        continue;
      }
      // The element now shows someone else, or an unrelated sentence: close out the old caption,
      // unless it was only a short draft that Meet is still revising.
      const draft = state.speaker === speaker
        && state.emittedText === null
        && state.text.split(' ').length <= DRAFT_MAX_WORDS
        && now - state.lastChange < this.settleMs;
      if (!draft) {
        this.emit(state);
        this.removed.push({ state, at: now });
      }
      this.blocks.set(element, this.adoptOrCreate(undefined, speaker, text, now));
    }

    for (const state of gone) {
      if (adopted.has(state)) continue;
      this.emit(state);
      this.removed.push({ state, at: now });
    }
    this.removed = this.removed.filter((entry) => !adopted.has(entry.state));
  }

  private adoptOrCreate(previous: BlockState | undefined, speaker: string | undefined, text: string, now: number): BlockState {
    if (previous) {
      const changed = text !== previous.emittedText;
      return { ...previous, speaker, text, lastChange: now, dirtySince: changed ? previous.dirtySince ?? now : null };
    }
    this.nextKey += 1;
    return { key: this.nextKey, speaker, text, firstSeen: now, lastChange: now, dirtySince: now, emittedText: null };
  }

  private flushDue(): void {
    const now = this.now();
    for (const state of this.blocks.values()) {
      if (state.dirtySince === null) continue;
      if (now - state.lastChange >= this.settleMs || now - state.dirtySince >= this.maxHoldMs) this.emit(state);
    }
  }

  private emit(state: BlockState): void {
    if (state.text === state.emittedText) {
      state.dirtySince = null;
      return;
    }
    state.emittedText = state.text;
    state.dirtySince = null;
    this.options.onCaption({ key: state.key, speaker: state.speaker, text: state.text, timestamp: state.firstSeen });
  }
}
