import { afterEach, describe, expect, it, vi } from 'vitest';
import { rewriteText } from '../src/popup/ai-writer-client';

afterEach(() => vi.unstubAllGlobals());

describe('popup rewrite client', () => {
  it('sends text and mode to the extension service worker and returns the result', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, result: { text: 'A clearer sentence.' } });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    await expect(rewriteText('original sentence', 'professional')).resolves.toBe('A clearer sentence.');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'AI_WRITER_GENERATE',
      request: { text: 'original sentence', mode: 'professional' },
    });
  });

  it('rejects blank input without sending a request', async () => {
    const sendMessage = vi.fn();
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    await expect(rewriteText('   ', 'rewrite')).rejects.toThrow('Paste or type text first');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('surfaces service errors and malformed replies', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: false, error: 'Add your API key.' }) } });
    await expect(rewriteText('Hello', 'rewrite')).rejects.toThrow('Add your API key.');

    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) } });
    await expect(rewriteText('Hello', 'rewrite')).rejects.toThrow('did not return a usable result');
  });
});
