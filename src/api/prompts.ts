import type { WritingMode } from '../shared/types';

const prompts: Record<WritingMode, string> = {
  rewrite: 'Rewrite the user text for clarity and flow. Preserve the original meaning. Do not add information. Return only the rewritten text.',
  grammar: 'Correct grammar, spelling, and punctuation in the user text. Preserve the original meaning and wording where possible. Do not add information. Return only the rewritten text.',
  professional: 'Rewrite the user text in a professional style. Preserve the original meaning. Do not add information. Return only the rewritten text.',
  casual: 'Rewrite the user text in a friendly, casual style. Preserve the original meaning. Do not add information. Return only the rewritten text.',
  shorten: 'Make the user text more concise. Preserve the original meaning and do not add information. Return only the rewritten text.',
  expand: 'Expand the user text with clearer phrasing and useful detail already implied by the original. Preserve the original meaning. Do not invent facts or add unsupported information. Return only the rewritten text.',
};

export function getSystemPrompt(mode: WritingMode): string {
  return `You are an expert writing assistant. ${prompts[mode]}`;
}
