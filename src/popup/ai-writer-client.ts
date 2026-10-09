import type { GenerateMessage, GenerateReply, WritingMode } from '../shared/types';

export async function rewriteText(text: string, mode: WritingMode): Promise<string> {
  if (!text.trim()) throw new Error('Paste or type text first.');

  let reply: GenerateReply | undefined;
  try {
    reply = await chrome.runtime.sendMessage<GenerateMessage, GenerateReply>({
      type: 'AI_WRITER_GENERATE',
      request: { text, mode },
    });
  } catch {
    throw new Error('AI Writer could not reach its background service. Reload the extension and try again.');
  }

  if (!reply || typeof reply !== 'object' || !('ok' in reply)) {
    throw new Error('AI Writer did not return a usable result. Please retry.');
  }
  if (!reply.ok) throw new Error(reply.error);
  if (typeof reply.result?.text !== 'string' || !reply.result.text.trim()) {
    throw new Error('AI Writer did not return a usable result. Please retry.');
  }
  return reply.result.text;
}
