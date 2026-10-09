import { describe, expect, it } from 'vitest';
import { findCaptionBlocks, parseCaptionBlock, readCaptionBlocks } from '../src/meet/speaker-parser';

function container(markup: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = markup;
  return root.firstElementChild as HTMLElement;
}

const read = (markup: string) => readCaptionBlocks(container(markup)).map(({ speaker, text }) => ({ speaker, text }));

describe('speaker parser: configured selectors', () => {
  it('reads speaker and text from known Meet class names', () => {
    const region = `
      <div role="region" aria-label="Captions">
        <div>
          <div class="nMcdL">
            <div class="adE6rb"><img src="a.png" alt=""><span class="NWpY1d">John</span></div>
            <div class="ygicle VbkSUe">We should probably release this on Friday.</div>
          </div>
        </div>
      </div>`;
    expect(read(region)).toEqual([{ speaker: 'John', text: 'We should probably release this on Friday.' }]);
  });
});

describe('speaker parser: selector priority', () => {
  it('takes the name from the most specific name element, not an outer header that holds extra labels', () => {
    const region = `
      <div role="region" aria-label="Captions"><div>
        <div class="nMcdL">
          <div class="adE6rb"><img alt=""><div class="KcIKyf"><span class="NWpY1d">John</span></div><span>(Presenting)</span></div>
          <div class="ygicle">We should release on Friday.</div>
        </div>
      </div></div>`;
    expect(read(region)).toEqual([{ speaker: 'John', text: 'We should release on Friday.' }]);
  });
});

describe('speaker parser: structural fallback', () => {
  const block = (name: string, text: string) =>
    `<div class="x1"><div class="x2"><img src="a.png" alt=""><span class="x3">${name}</span></div><div class="x4">${text}</div></div>`;

  it('reads several speakers when blocks are siblings inside wrappers', () => {
    const region = `<div role="region"><div><div>${block('John', 'We should release Friday.')}${block('Sarah', 'I agree.')}</div></div></div>`;
    expect(read(region)).toEqual([
      { speaker: 'John', text: 'We should release Friday.' },
      { speaker: 'Sarah', text: 'I agree.' },
    ]);
  });

  it('treats a single visible speaker as one block, not as separate name and text blocks', () => {
    expect(read(`<div role="region"><div>${block('You', 'Can everyone hear me?')}</div></div>`))
      .toEqual([{ speaker: 'You', text: 'Can everyone hear me?' }]);
    expect(read(`<div role="region">${block('You', 'Can everyone hear me?')}</div>`))
      .toEqual([{ speaker: 'You', text: 'Can everyone hear me?' }]);
  });

  it('treats the container itself as the block when it holds only name and text', () => {
    expect(read('<div role="region"><div><span>Priya</span></div><div>Let us start.</div></div>'))
      .toEqual([{ speaker: 'Priya', text: 'Let us start.' }]);
  });

  it('joins caption text that is split across inline spans', () => {
    const region = '<div role="region"><div><div><span>Dana</span></div><div><span>We should </span><span>ship it.</span></div></div></div>';
    expect(read(region)).toEqual([{ speaker: 'Dana', text: 'We should ship it.' }]);
  });

  it('ignores buttons and normalizes whitespace and a trailing colon on names', () => {
    const region = `
      <div role="region">
        <div>
          <div><span>  John : </span></div>
          <div>We   should
             release.</div>
        </div>
        <button>Jump to bottom</button>
      </div>`;
    expect(read(region)).toEqual([{ speaker: 'John', text: 'We should release.' }]);
  });

  it('returns text without a speaker when no name is present', () => {
    expect(read('<div role="region"><div>Just some caption text</div></div>'))
      .toEqual([{ speaker: undefined, text: 'Just some caption text' }]);
  });

  it('finds nothing in an empty container', () => {
    expect(read('<div role="region"><div></div><button>Settings</button></div>')).toEqual([]);
  });
});

describe('findCaptionBlocks / parseCaptionBlock', () => {
  it('returns the element for each block so the observer can track it across mutations', () => {
    const root = container('<div role="region"><div><div><b>A</b><p>one</p></div><div><b>B</b><p>two</p></div></div></div>');
    const blocks = findCaptionBlocks(root);
    expect(blocks).toHaveLength(2);
    expect(parseCaptionBlock(blocks[1])).toEqual({ speaker: 'B', text: 'two' });
  });
});
