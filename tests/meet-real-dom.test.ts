import { beforeEach, describe, expect, it } from 'vitest';
import { detectMeetPage, findCaptionContainer } from '../src/meet/meet-detector';
import { MEET_SELECTORS } from '../src/meet/selectors';
import { readCaptionBlocks } from '../src/meet/speaker-parser';

// Markup and class names below were read from a live Google Meet call on 2026-10-09 (captions turned
// on, nobody speaking) and from Meet's own stylesheet and templates. If Meet changes its markup, this
// is the first test that should fail: update src/meet/selectors.ts, then these fixtures.
const SILENT_CAPTIONS = `
  <div class="DtJ7e">
    <div jsname="dsyhDe" class="iOzk7">
      <div role="region" aria-label="Captions" class="vNKgIf UDinHf">
        <div><div class="GvZY2"></div></div>
        <div class="IMKgW">
          <div class="VfPpkd-dgl2Hf-ppHlrf-sM5MNb">
            <button aria-label="Jump to most recent captions" jsname="Xke7ne" class="UywwFc-LgbsSe">
              <span class="XjoK4b"></span><span jsname="V67aGc" class="UywwFc-vQzf8d">Jump to bottom</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>`;

// One speaker block as Meet's template renders it: avatar and name header, then the caption text.
const block = (name: string, text: string) => `
  <div class="nMcdL">
    <div class="adE6rb"><img class="Z6byG r6DyN" alt="" src="https://example.invalid/a.png"><div class="KcIKyf jxFHg"><span class="NWpY1d">${name}</span></div></div>
    <div class="ygicle VbkSUe">${text}</div>
  </div>`;

describe('real Google Meet markup', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('detects captions as on while the region is empty and nobody has spoken', () => {
    document.body.innerHTML = SILENT_CAPTIONS;
    expect(findCaptionContainer(document)?.element.className).toContain('vNKgIf');
    expect(detectMeetPage(document, '/ozd-gwkn-jhr').captions).toBe('on');
  });

  it('reads no captions from the silent region, ignoring the "Jump to bottom" button text', () => {
    document.body.innerHTML = SILENT_CAPTIONS;
    expect(readCaptionBlocks(findCaptionContainer(document)!.element)).toEqual([]);
  });

  it('reads speaker and text from Meet speaker blocks inside the region', () => {
    document.body.innerHTML = SILENT_CAPTIONS;
    const wrapper = document.querySelector('.vNKgIf > div')!;
    wrapper.insertAdjacentHTML('afterbegin', block('You', 'We should release this on Friday.') + block('Sarah', 'I agree.'));
    const readings = readCaptionBlocks(findCaptionContainer(document)!.element).map(({ speaker, text }) => ({ speaker, text }));
    expect(readings).toEqual([
      { speaker: 'You', text: 'We should release this on Friday.' },
      { speaker: 'Sarah', text: 'I agree.' },
    ]);
  });

  it('reads the caption toggle label, which names the action and has no aria-pressed', () => {
    document.body.innerHTML = '<button aria-label="Turn on captions" jsname="RrG0hf" role="button"></button>';
    expect(detectMeetPage(document, '/ozd-gwkn-jhr').captions).toBe('off');
    document.body.innerHTML = '<button aria-label="Turn off captions" jsname="RrG0hf" role="button"></button>';
    expect(detectMeetPage(document, '/ozd-gwkn-jhr').captions).toBe('on');
  });

  it('keeps the selector lists limited to names that exist in current Meet', () => {
    const dead = ['TBMuR', 'zs7s8d', 'bh44bd', 'iTTPOb', 'YSxPC'];
    const all = JSON.stringify(MEET_SELECTORS);
    for (const name of dead) expect(all).not.toContain(name);
  });
});
