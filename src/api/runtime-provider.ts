import type { AIProvider, AIRequest, AIResponse, GenerateMessage, GenerateReply } from '../shared/types';

/**
 * An AIProvider for contexts that must not hold the API key (content scripts). It forwards the
 * request to the service worker, which owns the key and the single OpenRouterProvider.
 */
export class RuntimeAIProvider implements AIProvider {
  async generate(request: AIRequest): Promise<AIResponse> {
    let reply: GenerateReply | undefined;
    try {
      reply = await chrome.runtime.sendMessage<GenerateMessage, GenerateReply>({ type: 'AI_WRITER_GENERATE', request });
    } catch {
      // Thrown when the extension was reloaded after this page loaded and its old script is orphaned.
      throw new Error('AI Writer was updated or reloaded. Refresh this page and try again.');
    }
    if (!reply || typeof reply !== 'object' || !('ok' in reply)) {
      throw new Error('AI Writer did not return a usable result. Please retry.');
    }
    if (!reply.ok) throw new Error(reply.error);
    if (typeof reply.result?.text !== 'string' || !reply.result.text.trim()) {
      throw new Error('AI Writer did not return a usable result. Please retry.');
    }
    return reply.result;
  }
}
