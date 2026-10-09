import { beforeEach, describe, expect, it } from 'vitest';
import { describeCaptionDom } from '../src/meet/debug-dump';

describe('describeCaptionDom', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('describes the caption structure without leaking caption text, names or the meeting code', () => {
    document.body.innerHTML = `
      <button aria-label="Turn on captions (c)" aria-pressed="false"></button>
      <div role="region" aria-label="Captions" tabindex="0" class="vNKgIf">
        <div class="wrap">
          <div class="nMcdL" data-participant-id="spaces/abc/devices/123">
            <div class="adE6rb"><img src="https://lh3.example/photo.jpg" alt="Secret Person"><span class="NWpY1d">Secret Person</span></div>
            <div class="ygicle VbkSUe">Secret meeting words about the merger</div>
          </div>
        </div>
      </div>`;
    const report = describeCaptionDom(document, '/abc-defg-hij');

    expect(report).not.toContain('Secret');
    expect(report).not.toContain('merger');
    expect(report).not.toContain('abc-defg-hij');
    expect(report).not.toContain('photo.jpg');
    expect(report).not.toContain('spaces/abc');
    expect(report).toContain('page: /xxx-xxxx-xxx');
    expect(report).toContain('captions: on');
    expect(report).toContain('container: found');
    expect(report).toContain('role="region"');
    expect(report).toContain('class="nMcdL"');
    expect(report).toContain('class="ygicle VbkSUe"');
    expect(report).toMatch(/⟨\d+ chars⟩/);
    expect(report).toContain('toggle: <button aria-label="Turn on captions (c)" aria-pressed="false">');
  });

  it('redacts aria-labels that could carry participant names but keeps known interface labels', () => {
    document.body.innerHTML = `
      <div role="region" aria-label="Captions">
        <div aria-label="Priya Raman, presenting"><button aria-label="Jump to most recent captions"></button></div>
      </div>`;
    const report = describeCaptionDom(document, '/abc-defg-hij');
    expect(report).not.toContain('Priya');
    expect(report).not.toContain('presenting');
    expect(report).toContain('aria-label="Captions"');
    expect(report).toContain('aria-label="Jump to most recent captions"');
    expect(report).toMatch(/aria-label="\[redacted, \d+ chars\]"/);
  });

  it('says so when there is no caption container or toggle', () => {
    document.body.innerHTML = '<div>nothing here</div>';
    const report = describeCaptionDom(document, '/landing');
    expect(report).toContain('page: /landing');
    expect(report).toContain('container: none found');
    expect(report).toContain('toggle: none found');
  });

  it('keeps the report bounded for huge containers', () => {
    const rows = Array.from({ length: 500 }, (_, i) => `<div class="row${i}"><span>text ${i}</span></div>`).join('');
    document.body.innerHTML = `<div role="region" aria-label="Captions">${rows}</div>`;
    expect(describeCaptionDom(document, '/abc-defg-hij').length).toBeLessThan(8_000);
  });
});
