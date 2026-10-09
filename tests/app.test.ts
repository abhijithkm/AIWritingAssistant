import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/popup/App';

vi.mock('../src/popup/meet-client', () => {
  class MeetUnavailableError extends Error {
    constructor() { super('Open a Google Meet meeting in this tab to use Meet Assistant.'); }
  }
  return {
    MeetUnavailableError,
    // Not on a Meet tab: the popup stays on Writer.
    pollMeetState: vi.fn(async () => { throw new MeetUnavailableError(); }),
    runMeetCommand: vi.fn(),
    fetchMeetText: vi.fn(),
    fetchMeetReport: vi.fn(),
  };
});

describe('popup App', () => {
  let container: HTMLElement;
  let root: Root;
  let stored: Record<string, unknown>;
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    stored = {};
    sendMessage = vi.fn(async () => ({ ok: true, result: { text: 'Please send me the report.' } }));
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({ ...stored })),
          set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(stored, values); }),
        },
      },
      runtime: { sendMessage },
      tabs: { query: vi.fn(async () => [{ id: 1 }]), sendMessage: vi.fn(), create: vi.fn() },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const text = () => container.textContent ?? '';
  const button = (pattern: RegExp) => Array.from(container.querySelectorAll('button')).find((b) => pattern.test(b.textContent ?? '') || pattern.test(b.getAttribute('aria-label') ?? ''));
  const click = async (element: Element | undefined) => {
    expect(element).toBeDefined();
    await act(async () => { (element as HTMLElement).click(); });
  };
  const type = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  async function mount() {
    await act(async () => { root.render(createElement(App)); });
    await act(async () => { await Promise.resolve(); });
  }
  const credit = () => container.querySelector('a[href="https://abhijithkm.space/"]');

  it('shows the developer credit on the Writer, Meet and Settings screens', async () => {
    await mount();
    expect(credit()).not.toBeNull();
    expect(text()).toContain('Developed by Abhijith KM');

    await click(button(/^Meet$/));
    expect(text()).toContain('Open a Google Meet meeting in this tab');
    expect(credit()).not.toBeNull();

    await click(button(/Open settings/));
    expect(text()).toContain('Your name (optional)');
    expect(credit()).not.toBeNull();
  });

  it('shows the extension logo in the header', async () => {
    await mount();
    const logo = container.querySelector<HTMLImageElement>('img.brand-logo');
    expect(logo).not.toBeNull();
    expect(logo!.getAttribute('src')).toBe('/icons/icon-128.png');
    expect(logo!.getAttribute('alt')).toBe('');
  });

  it('says why the side panel could not open instead of failing silently', async () => {
    await mount();
    await click(button(/Open in side panel/));
    expect(text()).toContain('The side panel is not available in this version of Chrome.');
  });

  it('offers the side panel and a separate window from the toolbar popup', async () => {
    await mount();
    expect(button(/Open in side panel/)).toBeDefined();
    expect(button(/Open in a window/)).toBeDefined();
    expect(button(/^Close/)).toBeUndefined();
  });

  it('offers a close button when running as a side panel', async () => {
    document.documentElement.dataset.surface = 'panel';
    try {
      await mount();
      expect(button(/Close panel/)).toBeDefined();
      expect(button(/Open in side panel/)).toBeUndefined();
    } finally {
      delete document.documentElement.dataset.surface;
    }
  });

  it('still rewrites text in Writer (Rewrite, then Replace input)', async () => {
    await mount();
    await type(container.querySelector<HTMLTextAreaElement>('#writing-input')!, 'i want to ask you if you can send me the report');
    await click(button(/^Rewrite$/));

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'AI_WRITER_GENERATE',
      request: { text: 'i want to ask you if you can send me the report', mode: 'rewrite' },
    });
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Rewritten text"]')!.value).toBe('Please send me the report.');

    await click(button(/^Replace input$/));
    expect(container.querySelector<HTMLTextAreaElement>('#writing-input')!.value).toBe('Please send me the report.');
  });

  it('saves the display name under its own key, never inside the settings that hold the API key', async () => {
    await mount();
    await click(button(/Open settings/));
    await type(container.querySelector<HTMLInputElement>('#api-key')!, 'sk-or-test');
    await type(container.querySelector<HTMLInputElement>('#user-name')!, 'Abhijith');
    await click(button(/^Save settings$/));

    expect(stored.aiWriterSettings).toEqual({ apiKey: 'sk-or-test', model: 'openrouter/free' });
    expect(stored.aiWriterUserName).toBe('Abhijith');
  });
});
