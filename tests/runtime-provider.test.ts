import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeAIProvider } from '../src/api/runtime-provider';

afterEach(() => vi.unstubAllGlobals());

const stubRuntime = (sendMessage: ReturnType<typeof vi.fn>) => vi.stubGlobal('chrome', { runtime: { sendMessage } });

describe('RuntimeAIProvider', () => {
  it('forwards the whole request to the service worker and unwraps the result', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, result: { text: 'Done.' } });
    stubRuntime(sendMessage);

    const request = { text: '[1] John: Hi.', system: 'You are an expert meeting assistant.', temperature: 0.2 };
    await expect(new RuntimeAIProvider().generate(request)).resolves.toEqual({ text: 'Done.' });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'AI_WRITER_GENERATE', request });
  });

  it('surfaces the service worker error message', async () => {
    stubRuntime(vi.fn().mockResolvedValue({ ok: false, error: 'OpenRouter is rate limiting requests. Please wait and retry.' }));
    await expect(new RuntimeAIProvider().generate({ text: 'x', system: 's' })).rejects.toThrow('rate limiting');
  });

  it('explains an orphaned content script after the extension reloads', async () => {
    stubRuntime(vi.fn().mockRejectedValue(new Error('Extension context invalidated.')));
    await expect(new RuntimeAIProvider().generate({ text: 'x', system: 's' })).rejects.toThrow('Refresh this page');
  });

  it('rejects empty or malformed replies', async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ok: true, result: { text: '   ' } });
    stubRuntime(sendMessage);
    const provider = new RuntimeAIProvider();
    await expect(provider.generate({ text: 'x', system: 's' })).rejects.toThrow('usable result');
    await expect(provider.generate({ text: 'x', system: 's' })).rejects.toThrow('usable result');
  });
});
