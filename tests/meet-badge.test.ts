import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Badge } from '../src/meet/badge';
import { makeSnapshot } from './helpers/meet-snapshot';

describe('Badge', () => {
  let shadow: ShadowRoot | undefined;

  beforeEach(() => {
    document.documentElement.querySelectorAll('[data-ai-writer-meet-badge]').forEach((node) => node.remove());
    const attachShadow = HTMLElement.prototype.attachShadow;
    vi.spyOn(HTMLElement.prototype, 'attachShadow').mockImplementation(function (this: HTMLElement, init: ShadowRootInit) {
      shadow = attachShadow.call(this, { ...init, mode: 'open' });
      return shadow;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    shadow = undefined;
  });

  const host = () => document.querySelector<HTMLElement>('[data-ai-writer-meet-badge]');
  const visible = () => !!host() && host()!.style.display !== 'none';

  it('stays out of the page until the assistant is active', () => {
    const badge = new Badge({ onStop: () => undefined });
    badge.update(makeSnapshot({ phase: 'idle' }));
    expect(visible()).toBe(false);
    badge.update(makeSnapshot({ phase: 'stopped', entryCount: 4 }));
    expect(visible()).toBe(false);
  });

  it('shows a persistent indicator that says captions are being processed', () => {
    const badge = new Badge({ onStop: () => undefined });
    badge.update(makeSnapshot({ phase: 'active', entryCount: 12 }));
    expect(visible()).toBe(true);
    const text = shadow!.textContent ?? '';
    expect(text).toContain('Meet Assistant active');
    expect(text).toContain('Reading visible captions');
    expect(text).toContain('12 lines');
    expect(shadow!.querySelector('[role="status"]')).not.toBeNull();
  });

  it('lets the user stop the assistant from the page', () => {
    const onStop = vi.fn();
    const badge = new Badge({ onStop });
    badge.update(makeSnapshot({ phase: 'active' }));
    shadow!.querySelector<HTMLButtonElement>('button.stop')!.click();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('asks the user to turn on captions when none are detected, and shows AI activity', () => {
    const badge = new Badge({ onStop: () => undefined });
    badge.update(makeSnapshot({ phase: 'active', page: { meetingDetected: true, meetingCode: 'abc-defg-hij', captions: 'off' } }));
    expect(shadow!.textContent).toContain('Turn on captions in Meet');

    badge.update(makeSnapshot({ phase: 'active', busy: { summary: true } }));
    expect(shadow!.textContent).toContain('AI is working');
  });

  it('hides again once the assistant stops', () => {
    const badge = new Badge({ onStop: () => undefined });
    badge.update(makeSnapshot({ phase: 'active' }));
    badge.update(makeSnapshot({ phase: 'stopped' }));
    expect(visible()).toBe(false);
  });
});
