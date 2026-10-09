import type { CaptionEvent, TranscriptEntry } from './types';
import { fingerprint, mergeGrowth, normalizeText } from './text-utils';

export type IngestResult = 'added' | 'updated' | 'duplicate';

// Meet re-renders captions that are still on screen, so identical text from the same speaker
// shortly after the first sighting is a re-render. Short replies ("Yes.") repeat legitimately, so
// they get a much shorter window.
const DUPLICATE_WINDOW_MS = 60_000;
const SHORT_DUPLICATE_WINDOW_MS = 8_000;
const SHORT_REPLY_WORDS = 3;
const EXTEND_LOOKBACK = 5;
const PRUNE_AT = 500;

function duplicateWindow(text: string): number {
  return text.split(' ').length <= SHORT_REPLY_WORDS ? SHORT_DUPLICATE_WINDOW_MS : DUPLICATE_WINDOW_MS;
}

/** The local transcript for one meeting session. Lives in memory only. */
export class TranscriptManager {
  private items: TranscriptEntry[] = [];
  private byId = new Map<string, TranscriptEntry>();
  private blockEntry = new Map<number, string>();
  private seen = new Map<string, number>();
  private revs: number[] = [];
  private counter = 0;
  private changes = 0;

  get entries(): readonly TranscriptEntry[] { return this.items; }
  get version(): number { return this.changes; }
  // One number per entry, bumped whenever its text grows. Lets analysis notice entries that changed after it ran.
  get revisions(): readonly number[] { return this.revs; }

  recent(count: number): TranscriptEntry[] {
    return this.items.slice(-count);
  }

  clear(): void {
    this.items = [];
    this.byId.clear();
    this.blockEntry.clear();
    this.seen.clear();
    this.revs = [];
    this.counter = 0;
    this.changes += 1;
  }

  ingest(caption: CaptionEvent): IngestResult {
    const text = normalizeText(caption.text);
    if (!text) return 'duplicate';
    const speaker = caption.speaker?.trim() || undefined;

    // The same DOM block grew, slid or was corrected since we last stored it.
    const linked = this.byId.get(this.blockEntry.get(caption.key) ?? '');
    if (linked && linked.speaker === speaker) {
      const merged = mergeGrowth(linked.text, text, { fuzzy: true });
      if (merged !== null) return this.setText(linked, merged, caption.timestamp) ? 'updated' : 'duplicate';
    }

    const print = fingerprint(speaker, text);
    const lastSeen = this.seen.get(print);
    if (lastSeen !== undefined && caption.timestamp - lastSeen < duplicateWindow(text)) {
      this.seen.set(print, caption.timestamp);
      return 'duplicate';
    }

    // A re-rendered block that repeats a recent entry and adds words extends that entry.
    const extendable = this.findExtendable(speaker, text, caption.timestamp);
    if (extendable) {
      this.blockEntry.set(caption.key, extendable.entry.id);
      this.setText(extendable.entry, extendable.merged, caption.timestamp);
      return 'updated';
    }

    this.counter += 1;
    const entry: TranscriptEntry = { id: `e${this.counter}`, speaker, text, timestamp: caption.timestamp };
    this.items.push(entry);
    this.revs.push(1);
    this.byId.set(entry.id, entry);
    this.blockEntry.set(caption.key, entry.id);
    this.remember(print, caption.timestamp);
    this.changes += 1;
    return 'added';
  }

  // Only the run of entries by this speaker that directly precedes the new caption can be extended.
  // Reaching past another speaker would move an answer in front of the question it answers.
  private findExtendable(speaker: string | undefined, text: string, timestamp: number): { entry: TranscriptEntry; merged: string } | null {
    for (let i = this.items.length - 1; i >= 0 && i >= this.items.length - EXTEND_LOOKBACK; i -= 1) {
      const entry = this.items[i];
      if (entry.speaker !== speaker || Math.abs(timestamp - entry.timestamp) > DUPLICATE_WINDOW_MS) break;
      const merged = mergeGrowth(entry.text, text);
      if (merged !== null && merged !== entry.text) return { entry, merged };
    }
    return null;
  }

  private setText(entry: TranscriptEntry, text: string, timestamp: number): boolean {
    if (text === entry.text) return false;
    entry.text = text;
    // Ids are sequential and entries are never removed, so an id maps straight to its position.
    this.revs[Number(entry.id.slice(1)) - 1] += 1;
    this.remember(fingerprint(entry.speaker, text), timestamp);
    this.changes += 1;
    return true;
  }

  private remember(print: string, timestamp: number): void {
    this.seen.delete(print);
    this.seen.set(print, timestamp);
    if (this.seen.size <= PRUNE_AT) return;
    for (const [key, at] of this.seen) {
      if (timestamp - at <= DUPLICATE_WINDOW_MS) break;
      this.seen.delete(key);
    }
  }
}
