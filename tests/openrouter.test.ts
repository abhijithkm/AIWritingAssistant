import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterProvider } from '../src/api/openrouter';

afterEach(() => vi.unstubAllGlobals());

describe('OpenRouterProvider', () => {
  it('sends mode instructions and selected text separately, then returns generated text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'Please send me the report.' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await new OpenRouterProvider('test-key').generate({
      text: 'i want to ask you if you can send me the report',
      mode: 'professional',
    });

    expect(response.text).toBe('Please send me the report.');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'openrouter/free',
      messages: [
        { role: 'system', content: expect.stringContaining('professional style') },
        { role: 'user', content: 'i want to ask you if you can send me the report' },
      ],
    });
  });

  it('uses an explicit system prompt and temperature instead of a writing mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await new OpenRouterProvider('test-key').generate({
      text: '[1] John: Ship it Friday.',
      system: 'You are an expert meeting assistant.',
      temperature: 0.2,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are an expert meeting assistant.' },
      { role: 'user', content: '[1] John: Ship it Friday.' },
    ]);
    expect(body.temperature).toBe(0.2);
  });

  it('omits temperature for writing requests and rejects requests with no instructions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'Hi' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenRouterProvider('test-key');

    await provider.generate({ text: 'hello', mode: 'rewrite' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).not.toHaveProperty('temperature');

    await expect(provider.generate({ text: 'hello' })).rejects.toThrow('instructions');
  });

  it('rejects missing keys and malformed successful responses with readable errors', async () => {
    await expect(new OpenRouterProvider('').generate({ text: 'Hello', mode: 'rewrite' }))
      .rejects.toThrow('Add your OpenRouter API key');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(new OpenRouterProvider('test-key').generate({ text: 'Hello', mode: 'rewrite' }))
      .rejects.toThrow('no usable text');
  });

  it('explains invalid credentials and rate limiting', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 429 })));
    const provider = new OpenRouterProvider('test-key');
    await expect(provider.generate({ text: 'Hello', mode: 'rewrite' })).rejects.toThrow('rejected the API key');
    await expect(provider.generate({ text: 'Hello', mode: 'rewrite' })).rejects.toThrow('rate limiting');
  });

  it('uses the HTTP status when an error response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('<html>Unauthorized</html>', {
        status: 401,
        headers: { 'Content-Type': 'text/html' },
      }))
      .mockResolvedValueOnce(new Response('upstream unavailable', {
        status: 502,
        headers: { 'Content-Type': 'text/plain' },
      })));
    const provider = new OpenRouterProvider('test-key');

    await expect(provider.generate({ text: 'Hello', mode: 'rewrite' }))
      .rejects.toThrow('rejected the API key');
    await expect(provider.generate({ text: 'Hello', mode: 'rewrite' }))
      .rejects.toThrow('HTTP 502');
  });
});
