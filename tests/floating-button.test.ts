import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { genericEditorAdapter } from '../src/content/editor';
import { FloatingButton } from '../src/content/floating-button';
import type { GenerateReply } from '../src/shared/types';

const rect = { left: 10, bottom: 30 } as DOMRect;
let shadow: ShadowRoot;

beforeEach(() => {
  // The widget uses a closed shadow root; open it so the tests can inspect the rendered card.
  const attachShadow = HTMLElement.prototype.attachShadow;
  vi.spyOn(HTMLElement.prototype, 'attachShadow').mockImplementation(function (this: HTMLElement, init: ShadowRootInit) {
    shadow = attachShadow.call(this, { ...init, mode: 'open' });
    return shadow;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function field(text: string, start: number, end: number): HTMLTextAreaElement {
  const element = document.createElement('textarea');
  element.value = text;
  document.body.append(element);
  element.setSelectionRange(start, end);
  return element;
}

function pressButton(label: string): void {
  const button = [...shadow.querySelectorAll('button')].find((item) => item.textContent === label);
  if (!button) throw new Error(`No "${label}" button rendered`);
  button.click();
}

const openMenu = () => (shadow.querySelector('.trigger') as HTMLElement).click();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const ok = (text: string): GenerateReply => ({ ok: true, result: { text } });

describe('floating button', () => {
  it('requests the captured text, shows the result and replaces the selection', async () => {
    const request = vi.fn().mockResolvedValue(ok('kind'));
    const widget = new FloatingButton(request, (bookmark, text) => genericEditorAdapter.replaceBookmark(bookmark, text));
    const element = field('hello brave world', 6, 11);

    widget.show(genericEditorAdapter.capture(element), 'brave', rect);
    openMenu();
    pressButton('Grammar');
    await flush();

    expect(request).toHaveBeenCalledWith('brave', 'grammar');
    expect(shadow.querySelector('.result-text')?.textContent).toBe('kind');

    pressButton('Replace');
    expect(element.value).toBe('hello kind world');
    expect(shadow.host.getAttribute('style')).toContain('display: none');
  });

  it('sits below the selection, and opens above it when there is no room below', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(260);
    vi.stubGlobal('innerHeight', 900);
    const widget = new FloatingButton(vi.fn(), vi.fn());
    const element = field('hello brave world', 6, 11);

    widget.show(genericEditorAdapter.capture(element), 'brave', { left: 10, top: 100, bottom: 120 } as DOMRect);
    expect((shadow.host as HTMLElement).style.top).toBe('128px');

    widget.show(genericEditorAdapter.capture(element), 'brave', { left: 10, top: 800, bottom: 820 } as DOMRect);
    expect((shadow.host as HTMLElement).style.top).toBe('592px');
  });

  it('keeps an open card when the same selection is reported again', () => {
    const widget = new FloatingButton(vi.fn(), vi.fn());
    const element = field('hello brave world', 6, 11);

    widget.show(genericEditorAdapter.capture(element), 'brave', rect);
    openMenu();
    widget.show(genericEditorAdapter.capture(element), 'brave', rect);

    expect(shadow.querySelector('.modes')).not.toBeNull();
    expect(shadow.querySelector('.trigger')).toBeNull();
  });

  it('drops an answer that arrives after the selection changed', async () => {
    let resolve!: (reply: GenerateReply) => void;
    const request = vi.fn().mockReturnValue(new Promise<GenerateReply>((done) => { resolve = done; }));
    const widget = new FloatingButton(request, vi.fn());
    const element = field('hello brave world', 6, 11);

    widget.show(genericEditorAdapter.capture(element), 'brave', rect);
    openMenu();
    pressButton('Rewrite');
    element.setSelectionRange(12, 17);
    widget.show(genericEditorAdapter.capture(element), 'world', rect);
    resolve(ok('kind'));
    await flush();

    expect(shadow.querySelector('.trigger')).not.toBeNull();
    expect(shadow.querySelector('.result-text')).toBeNull();
  });

  it('keeps a pending answer across a brief hide and re-show of the same selection', async () => {
    let resolve!: (reply: GenerateReply) => void;
    const request = vi.fn().mockReturnValue(new Promise<GenerateReply>((done) => { resolve = done; }));
    const widget = new FloatingButton(request, vi.fn());
    const element = field('hello brave world', 6, 11);

    widget.show(genericEditorAdapter.capture(element), 'brave', rect);
    openMenu();
    pressButton('Rewrite');
    widget.hide();
    widget.show(genericEditorAdapter.capture(element), 'brave', rect);
    expect(shadow.querySelector('.spinner')).not.toBeNull();

    resolve(ok('kind'));
    await flush();
    expect(shadow.querySelector('.result-text')?.textContent).toBe('kind');
  });

  it('shows an error and leaves the text alone when it changed before Replace', async () => {
    const widget = new FloatingButton(vi.fn().mockResolvedValue(ok('kind')), (bookmark, text) => genericEditorAdapter.replaceBookmark(bookmark, text));
    const element = field('hello brave world', 6, 11);

    widget.show(genericEditorAdapter.capture(element), 'brave', rect);
    openMenu();
    pressButton('Rewrite');
    await flush();
    element.value = 'something else entirely';
    pressButton('Replace');

    expect(shadow.querySelector('.error')?.textContent).toContain('changed after you selected it');
    expect(element.value).toBe('something else entirely');
  });
});
