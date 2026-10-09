import { describe, expect, it } from 'vitest';
import { TranscriptManager } from '../src/meet/transcript-manager';

const caption = (key: number, speaker: string | undefined, text: string, timestamp = 1_000) => ({ key, speaker, text, timestamp });

describe('TranscriptManager', () => {
  it('adds a new entry with a sequential id, speaker, text and timestamp', () => {
    const manager = new TranscriptManager();
    expect(manager.ingest(caption(1, 'John', 'We should release on Friday.', 123_456_789))).toBe('added');
    expect(manager.entries).toEqual([
      { id: 'e1', speaker: 'John', text: 'We should release on Friday.', timestamp: 123_456_789 },
    ]);
  });

  it('skips a duplicate caused by the DOM re-rendering the same speaker and text', () => {
    const manager = new TranscriptManager();
    manager.ingest(caption(1, 'John', 'We should release on Friday.', 1_000));
    expect(manager.ingest(caption(2, 'John', '  We should   release on Friday. ', 2_000))).toBe('duplicate');
    expect(manager.entries).toHaveLength(1);
  });

  it('allows the same short reply again once the dedupe window has passed', () => {
    const manager = new TranscriptManager();
    manager.ingest(caption(1, 'Sarah', 'Yes.', 1_000));
    expect(manager.ingest(caption(2, 'Sarah', 'Yes.', 3_000))).toBe('duplicate');
    expect(manager.ingest(caption(3, 'Sarah', 'Yes.', 20_000))).toBe('added');
    expect(manager.entries).toHaveLength(2);
  });

  it('updates the same entry in place while one block keeps growing', () => {
    const manager = new TranscriptManager();
    manager.ingest(caption(1, 'John', 'We should', 1_000));
    expect(manager.ingest(caption(1, 'John', 'We should probably release this on Friday.', 1_500))).toBe('updated');
    expect(manager.entries).toEqual([
      { id: 'e1', speaker: 'John', text: 'We should probably release this on Friday.', timestamp: 1_000 },
    ]);
  });

  it('keeps words that slid out of a long caption block', () => {
    const manager = new TranscriptManager();
    manager.ingest(caption(1, 'John', 'so first we need to check the logs and then restart', 1_000));
    manager.ingest(caption(1, 'John', 'check the logs and then restart the service tonight', 4_000));
    expect(manager.entries).toHaveLength(1);
    expect(manager.entries[0].text).toBe('so first we need to check the logs and then restart the service tonight');
  });

  it('starts a new entry when a reused block shows an unrelated sentence', () => {
    const manager = new TranscriptManager();
    manager.ingest(caption(1, 'John', 'We should release on Friday.', 1_000));
    expect(manager.ingest(caption(1, 'John', 'Can everyone see my screen?', 9_000))).toBe('added');
    expect(manager.entries.map((e) => e.id)).toEqual(['e1', 'e2']);
    // The block now points at the new entry, so further growth extends e2.
    manager.ingest(caption(1, 'John', 'Can everyone see my screen? Great.', 9_500));
    expect(manager.entries[1].text).toBe('Can everyone see my screen? Great.');
  });

  it('does not merge a block that switched to a different speaker', () => {
    const manager = new TranscriptManager();
    manager.ingest(caption(1, 'John', 'We should release on Friday.', 1_000));
    expect(manager.ingest(caption(1, 'Sarah', 'We should release on Friday and test.', 2_000))).toBe('added');
    expect(manager.entries).toHaveLength(2);
  });

  it('extends the previous entry when a re-rendered block repeats it with more words', () => {
    const manager = new TranscriptManager();
    manager.ingest(caption(1, 'John', 'We should release on Friday.', 1_000));
    expect(manager.ingest(caption(2, 'John', 'We should release on Friday. After the regression tests.', 3_000))).toBe('updated');
    expect(manager.entries).toHaveLength(1);
    expect(manager.entries[0].text).toBe('We should release on Friday. After the regression tests.');
  });

  it('does not glue a reply onto an older entry from the same speaker across another speaker', () => {
    const manager = new TranscriptManager();
    manager.ingest(caption(1, 'Alice', 'Okay.', 1_000));
    manager.ingest(caption(2, 'Bob', 'Can you finish the report by Friday?', 20_000));
    manager.ingest(caption(3, 'Alice', "Okay, I'll finish it by Thursday.", 40_000));
    expect(manager.entries.map((e) => [e.speaker, e.text])).toEqual([
      ['Alice', 'Okay.'],
      ['Bob', 'Can you finish the report by Friday?'],
      ['Alice', "Okay, I'll finish it by Thursday."],
    ]);
  });

  it('tracks a revision per entry that changes only when its text changes', () => {
    const manager = new TranscriptManager();
    manager.ingest(caption(1, 'John', 'We should', 1_000));
    manager.ingest(caption(2, 'Sarah', 'I agree with that plan.', 2_000));
    expect(manager.revisions).toEqual([1, 1]);
    manager.ingest(caption(1, 'John', 'We should release on Friday.', 3_000));
    expect(manager.revisions).toEqual([2, 1]);
    manager.ingest(caption(1, 'John', 'We should release on Friday.', 3_500));
    expect(manager.revisions).toEqual([2, 1]);
    manager.clear();
    expect(manager.revisions).toEqual([]);
  });

  it('keeps similar sentences from different speakers separate', () => {
    const manager = new TranscriptManager();
    manager.ingest(caption(1, 'John', 'We should release on Friday.', 1_000));
    manager.ingest(caption(2, 'Sarah', 'We should release on Friday. I agree.', 2_000));
    expect(manager.entries).toHaveLength(2);
  });

  it('ignores empty captions and tracks a version that changes only on real changes', () => {
    const manager = new TranscriptManager();
    const v0 = manager.version;
    expect(manager.ingest(caption(1, 'John', '   '))).toBe('duplicate');
    expect(manager.version).toBe(v0);
    manager.ingest(caption(1, 'John', 'Hello team.'));
    const v1 = manager.version;
    expect(v1).toBeGreaterThan(v0);
    manager.ingest(caption(2, 'John', 'Hello team.', 1_500));
    expect(manager.version).toBe(v1);
  });

  it('returns the newest entries and resets completely on clear', () => {
    const manager = new TranscriptManager();
    for (let i = 1; i <= 5; i += 1) manager.ingest(caption(i, 'John', `Line number ${i} is here.`, i * 100_000));
    expect(manager.recent(2).map((e) => e.id)).toEqual(['e4', 'e5']);
    manager.clear();
    expect(manager.entries).toHaveLength(0);
    manager.ingest(caption(9, 'John', 'Line number 1 is here.', 1_000));
    expect(manager.entries[0].id).toBe('e1');
  });
});
