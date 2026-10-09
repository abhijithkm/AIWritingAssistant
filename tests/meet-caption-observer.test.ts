import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptionObserver } from '../src/meet/caption-observer';
import type { CaptionEvent } from '../src/meet/types';

const block = (name: string, text: string) =>
  `<div class="blk"><div class="who"><span>${name}</span></div><div class="txt">${text}</div></div>`;

function mountRegion(blocks: Array<[string, string]> = []): HTMLElement {
  const region = document.createElement('div');
  region.setAttribute('role', 'region');
  region.setAttribute('aria-label', 'Captions');
  region.innerHTML = `<div>${blocks.map(([name, text]) => block(name, text)).join('')}</div>`;
  document.body.append(region);
  return region;
}

const setText = (region: HTMLElement, text: string, index = 0) => {
  region.querySelectorAll('.txt')[index].textContent = text;
};

async function tick(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('CaptionObserver', () => {
  let captions: CaptionEvent[];
  let statuses: boolean[];
  let observer: CaptionObserver;

  const create = () => new CaptionObserver({
    settleMs: 1_000,
    maxHoldMs: 3_000,
    scanMs: 250,
    onCaption: (c) => captions.push(c),
    onStatus: (s) => statuses.push(s.containerFound),
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    document.body.innerHTML = '';
    captions = [];
    statuses = [];
    observer = create();
  });
  afterEach(() => {
    observer.stop();
    vi.useRealTimers();
  });

  it('emits one caption after growing text settles, not one per growth step', async () => {
    const region = mountRegion([['John', 'We should']]);
    observer.start();
    await tick(300);
    setText(region, 'We should probably');
    await tick(300);
    setText(region, 'We should probably release this on Friday.');
    await tick(600);
    expect(captions).toHaveLength(0);

    await tick(1_500);
    expect(captions).toHaveLength(1);
    expect(captions[0]).toMatchObject({ speaker: 'John', text: 'We should probably release this on Friday.', timestamp: 1_000_000 });
  });

  it('emits periodically while one speaker keeps talking, so words that scroll away are kept', async () => {
    const region = mountRegion([['John', 'one']]);
    observer.start();
    const words = ['one'];
    for (let i = 0; i < 24; i += 1) {
      await tick(300);
      words.push(`word${i}`);
      setText(region, words.join(' '));
    }
    await tick(1_500);
    expect(captions.length).toBeGreaterThanOrEqual(2);
    expect(new Set(captions.map((c) => c.key)).size).toBe(1);
    expect(captions.at(-1)?.text).toBe(words.join(' '));
  });

  it('flushes pending text immediately when Meet removes the caption block', async () => {
    const region = mountRegion([['John', 'We should release on Friday.']]);
    observer.start();
    await tick(300);
    region.firstElementChild!.innerHTML = '';
    await tick(300);
    expect(captions).toHaveLength(1);
    expect(captions[0].text).toBe('We should release on Friday.');
  });

  it('flushes pending text on stop and then stays silent', async () => {
    const region = mountRegion([['John', 'Quick thought.']]);
    observer.start();
    await tick(300);
    observer.stop();
    expect(captions).toHaveLength(1);
    setText(region, 'Quick thought. And more.');
    await tick(5_000);
    expect(captions).toHaveLength(1);
  });

  it('tracks several speakers independently', async () => {
    mountRegion([['John', 'We should release Friday.'], ['Sarah', 'I agree.']]);
    observer.start();
    await tick(2_000);
    expect(captions.map((c) => [c.speaker, c.text])).toEqual([
      ['John', 'We should release Friday.'],
      ['Sarah', 'I agree.'],
    ]);
    expect(captions[0].key).not.toBe(captions[1].key);
  });

  it('does not re-emit when Meet re-renders the same caption into new elements', async () => {
    const region = mountRegion([['John', 'We should release on Friday.']]);
    observer.start();
    await tick(2_000);
    expect(captions).toHaveLength(1);

    region.innerHTML = `<div>${block('John', 'We should release on Friday.')}</div>`;
    await tick(2_000);
    expect(captions).toHaveLength(1);
  });

  it('keeps the same block key when a re-rendered element carries extended text', async () => {
    const region = mountRegion([['John', 'We should release']]);
    observer.start();
    await tick(2_000);
    region.innerHTML = `<div>${block('John', 'We should release on Friday.')}</div>`;
    await tick(2_000);
    expect(captions.map((c) => c.text)).toEqual(['We should release', 'We should release on Friday.']);
    expect(captions[0].key).toBe(captions[1].key);
  });

  it('keeps words that slid out of a block before they were ever emitted', async () => {
    const region = mountRegion([['John', 'so first we need to check the logs and then restart']]);
    observer.start();
    await tick(300);
    setText(region, 'check the logs and then restart the service tonight');
    await tick(2_000);
    expect(captions.at(-1)?.text).toBe('so first we need to check the logs and then restart the service tonight');
  });

  it('closes out a long caption instead of shrinking it when the block suddenly shows fewer words', async () => {
    const long = 'So I will send the report to the client by Friday afternoon after review';
    const region = mountRegion([['John', long]]);
    observer.start();
    await tick(300);
    setText(region, 'I will send the report to Sam');
    await tick(2_000);
    expect(captions.map((c) => c.text)).toEqual([long, 'I will send the report to Sam']);
  });

  // Modelled on a real Meet call: one caption grew for minutes, with the recognizer rewriting the
  // last word's punctuation or ending as it went ("arrest." became "arrests").
  it('follows a long caption through recognizer corrections as one caption', async () => {
    const region = mountRegion([['You', 'There were no arrest.']]);
    observer.start();
    for (const step of [
      'There were no arrests and no officially.',
      'There were no arrests and no officially confirmed motive.',
      'There were no arrests and no officially confirmed motive, the prosecutor said.',
    ]) {
      await tick(400);
      setText(region, step);
    }
    await tick(2_000);
    expect(new Set(captions.map((c) => c.key)).size).toBe(1);
    expect(captions.at(-1)?.text).toBe('There were no arrests and no officially confirmed motive, the prosecutor said.');
  });

  it('drops a short unsettled draft that Meet replaces with a different recognition', async () => {
    const region = mountRegion([['You', 'Help. And. He']]);
    observer.start();
    await tick(300);
    setText(region, 'Release plan is Friday.');
    await tick(2_000);
    expect(captions.map((c) => c.text)).toEqual(['Release plan is Friday.']);
  });

  it('keeps a short caption that had already settled before the block changed', async () => {
    const region = mountRegion([['You', 'Okay.']]);
    observer.start();
    await tick(2_000);
    setText(region, 'Release plan is Friday.');
    await tick(2_000);
    expect(captions.map((c) => c.text)).toEqual(['Okay.', 'Release plan is Friday.']);
  });

  it('keeps a short caption when a different speaker takes over the same element', async () => {
    const region = mountRegion([['You', 'Help. And. He']]);
    observer.start();
    await tick(300);
    region.querySelector('.who span')!.textContent = 'Sarah';
    setText(region, 'Release plan is Friday.');
    await tick(2_000);
    expect(captions.map((c) => [c.speaker, c.text])).toEqual([['You', 'Help. And. He'], ['Sarah', 'Release plan is Friday.']]);
  });

  it('starts a new block key when the same element shows a different sentence', async () => {
    const region = mountRegion([['John', 'We should release on Friday.']]);
    observer.start();
    await tick(300);
    setText(region, 'Can everyone see my screen?');
    await tick(2_000);
    expect(captions.map((c) => c.text)).toEqual(['We should release on Friday.', 'Can everyone see my screen?']);
    expect(captions[0].key).not.toBe(captions[1].key);
  });

  it('waits for the caption container to appear and reports status changes', async () => {
    observer.start();
    await tick(1_000);
    expect(statuses.at(-1)).toBe(false);

    mountRegion([['John', 'Captions just turned on.']]);
    await tick(2_500);
    expect(statuses.at(-1)).toBe(true);
    expect(captions.map((c) => c.text)).toEqual(['Captions just turned on.']);
  });

  it('survives the container being replaced without duplicating captions', async () => {
    const region = mountRegion([['John', 'We should release on Friday.']]);
    observer.start();
    await tick(2_000);
    region.remove();
    await tick(500);
    expect(statuses.at(-1)).toBe(false);

    mountRegion([['John', 'We should release on Friday.']]);
    await tick(2_500);
    expect(statuses.at(-1)).toBe(true);
    expect(captions).toHaveLength(1);
  });

  it('can be restarted after stopping', async () => {
    mountRegion([['John', 'First meeting line.']]);
    observer.start();
    await tick(2_000);
    observer.stop();
    document.body.innerHTML = '';
    mountRegion([['Sarah', 'Second session line.']]);
    observer.start();
    await tick(2_000);
    expect(captions.map((c) => c.text)).toEqual(['First meeting line.', 'Second session line.']);
  });
});
