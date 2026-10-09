import { describe, expect, it } from 'vitest';
import { fingerprint, mergeGrowth, normalizeText } from '../src/meet/text-utils';

describe('normalizeText', () => {
  it('collapses whitespace, including non-breaking spaces and newlines', () => {
    expect(normalizeText('  We  should release\n on   Friday.  ')).toBe('We should release on Friday.');
  });
});

describe('fingerprint', () => {
  it('is stable for the same speaker and text regardless of case or spacing', () => {
    expect(fingerprint('John', 'We should  release.')).toBe(fingerprint('John', ' we should release. '));
  });

  it('differs by speaker and by text', () => {
    expect(fingerprint('John', 'Hello there')).not.toBe(fingerprint('Sarah', 'Hello there'));
    expect(fingerprint('John', 'Hello there')).not.toBe(fingerprint('John', 'Hello there again'));
    expect(fingerprint(undefined, 'Hello')).toBe(fingerprint('', 'Hello'));
  });
});

describe('mergeGrowth', () => {
  it('returns the longer text when the caption grew in place', () => {
    expect(mergeGrowth('We should', 'We should probably release')).toBe('We should probably release');
  });

  it('keeps the earlier text when the new text is only a shorter prefix', () => {
    expect(mergeGrowth('We should probably release', 'We should probably')).toBe('We should probably release');
  });

  it('stitches a sliding window by overlapping words', () => {
    const merged = mergeGrowth(
      'so first we need to check the logs and then restart',
      'check the logs and then restart the service tonight',
    );
    expect(merged).toBe('so first we need to check the logs and then restart the service tonight');
  });

  it('uses the newer words, with their corrected punctuation, when the new text contains the old', () => {
    expect(mergeGrowth('We went there.', 'We went there today.')).toBe('We went there today.');
    expect(mergeGrowth('no arrests and no officially.', 'no arrests and no officially confirmed motive.'))
      .toBe('no arrests and no officially confirmed motive.');
  });

  it('returns null for unrelated text', () => {
    expect(mergeGrowth('We should release on Friday.', 'Can everyone see my screen?')).toBeNull();
  });

  it('does not stitch a one-word overlap from a different utterance', () => {
    expect(mergeGrowth('Okay.', "Okay, I'll finish it by Thursday.")).toBeNull();
    expect(mergeGrowth('Thanks', 'Thanks a lot for that')).toBe('Thanks a lot for that');
  });

  it('only treats a prefix as growth at a word boundary', () => {
    expect(mergeGrowth('Yes', 'Yesterday we met.')).toBeNull();
    expect(mergeGrowth('Yes.', 'Yes. Then we go.')).toBe('Yes. Then we go.');
    expect(mergeGrowth('We should probably release', 'We should probably')).toBe('We should probably release');
  });

  it('never lets a fuzzy match replace a long caption with a much shorter one', () => {
    const long = 'So I will send the report to the client by Friday afternoon after review';
    expect(mergeGrowth(long, 'I will send the report to Sam', { fuzzy: true })).toBeNull();
  });

  it('only accepts a fuzzy ASR correction when asked to', () => {
    const before = 'wee should release on friday';
    const after = 'we should release on friday and test first';
    expect(mergeGrowth(before, after)).toBeNull();
    expect(mergeGrowth(before, after, { fuzzy: true })).toBe(after);
  });
});
