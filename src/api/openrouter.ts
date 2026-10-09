import type { AIProvider, AIRequest, AIResponse } from '../shared/types';
import { getSystemPrompt } from './prompts';

interface OpenRouterPayload {
  choices?: Array<{ message?: { content?: unknown } }>;
  error?: { message?: string; code?: number | string };
}

export class OpenRouterProvider implements AIProvider {
  constructor(private readonly apiKey: string) {}

  async generate(request: AIRequest): Promise<AIResponse> {
    if (!this.apiKey.trim()) throw new Error('Add your OpenRouter API key in the extension settings.');
    if (!request.text.trim()) throw new Error('Select some text before asking AI Writer.');
    const system = request.system ?? (request.mode ? getSystemPrompt(request.mode) : '');
    if (!system) throw new Error('AI request is missing instructions.');

    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model || 'openrouter/free',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: request.text },
          ],
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        }),
      });
    } catch {
      throw new Error('Could not reach OpenRouter. Check your internet connection and try again.');
    }

    let body: string;
    try {
      body = await response.text();
    } catch {
      throw new Error('OpenRouter returned an unreadable response. Please retry.');
    }

    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
    let payload: OpenRouterPayload | undefined;
    if (body.trim()) {
      try {
        payload = JSON.parse(body) as OpenRouterPayload;
      } catch {
        // Non-JSON error pages are handled below using their HTTP status.
      }
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('OpenRouter rejected the API key. Check the key in extension settings.');
      }
      if (response.status === 429) throw new Error('OpenRouter is rate limiting requests. Please wait and retry.');
      const message = payload?.error?.message;
      if (message) throw new Error(message);
      throw new Error(`OpenRouter request failed (HTTP ${response.status}${contentType ? `, ${contentType}` : ''}). Please retry in a moment.`);
    }

    if (!payload) {
      const kind = body.trim() ? 'unreadable' : 'empty';
      throw new Error(`OpenRouter returned an ${kind} response (HTTP ${response.status}${contentType ? `, ${contentType}` : ''}). Please retry.`);
    }
    if (payload.error?.message) throw new Error(payload.error.message);

    const text = payload.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('OpenRouter returned no usable text. Please retry.');
    }
    return { text: text.trim() };
  }
}
