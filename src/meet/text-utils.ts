export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// Compare words ignoring case and punctuation so "Friday." matches "friday".
function wordKey(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
}

// FNV-1a: a small, stable, synchronous hash. Collisions only cost a skipped duplicate check, never data.
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function fingerprint(speaker: string | undefined, text: string): string {
  return hash(`${(speaker ?? '').trim().toLowerCase()}|${normalizeText(text).toLowerCase()}`);
}

interface MergeOptions {
  // Accept an ASR correction (most earlier words kept, but not a clean prefix) as the same caption.
  fuzzy?: boolean;
}

// A sliding window must overlap by this many words, or a repeated "Okay," would stitch two utterances.
const MIN_OVERLAP_WORDS = 3;
const FUZZY_KEPT_WORDS = 0.7;
const FUZZY_MIN_LENGTH = 0.8;

const isWordChar = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}]/u.test(char);

// "Yes" is growth into "Yes. Then we go" but not into "Yesterday".
function startsAtWordBoundary(full: string, prefix: string): boolean {
  if (!full.startsWith(prefix)) return false;
  return full.length === prefix.length || !isWordChar(prefix.at(-1)) || !isWordChar(full[prefix.length]);
}

/**
 * Combines two snapshots of one caption block. Meet grows a caption in place, slides older words
 * off the front, and occasionally corrects earlier words. Returns the merged text, or null when
 * `next` is a different utterance.
 */
export function mergeGrowth(prev: string, next: string, options: MergeOptions = {}): string | null {
  const p = normalizeText(prev);
  const n = normalizeText(next);
  if (!p) return n || null;
  if (!n || n === p) return p;

  const pl = p.toLowerCase();
  const nl = n.toLowerCase();
  if (startsAtWordBoundary(nl, pl)) return n;
  if (startsAtWordBoundary(pl, nl)) return p;

  const pWords = p.split(' ');
  const nWords = n.split(' ');
  const pKeys = pWords.map(wordKey);
  const nKeys = nWords.map(wordKey);

  const longest = Math.min(pKeys.length, nKeys.length);
  for (let k = longest; k >= MIN_OVERLAP_WORDS; k -= 1) {
    // The overlapping words come from the newer text, which carries Meet's latest punctuation and spelling.
    if (pKeys.slice(-k).every((key, i) => key === nKeys[i])) return [...pWords.slice(0, pWords.length - k), ...nWords].join(' ');
  }

  if (options.fuzzy) {
    // A correction keeps most of what was there and is not meaningfully shorter. Anything else is a new utterance.
    const earlier = new Set(pKeys.filter(Boolean));
    const later = new Set(nKeys.filter(Boolean));
    const kept = [...earlier].filter((key) => later.has(key)).length;
    if (earlier.size >= 3 && kept / earlier.size >= FUZZY_KEPT_WORDS && nWords.length >= pWords.length * FUZZY_MIN_LENGTH) return n;
  }
  return null;
}
