import { describe, expect, it } from 'vitest';
import { getSystemPrompt } from '../src/api/prompts';
import type { WritingMode } from '../src/shared/types';

describe('writing mode prompts', () => {
  it('provides a distinct instruction for every mode and preserves meaning', () => {
    const modes: WritingMode[] = ['rewrite', 'grammar', 'professional', 'casual', 'shorten', 'expand'];
    const prompts = modes.map(getSystemPrompt);
    expect(new Set(prompts).size).toBe(modes.length);
    expect(prompts.every((prompt) => prompt.includes('Preserve the original meaning'))).toBe(true);
    expect(prompts.every((prompt) => prompt.includes('Return only the rewritten text'))).toBe(true);
  });
});
