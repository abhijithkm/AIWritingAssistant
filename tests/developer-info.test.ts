import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import DeveloperCredit from '../src/popup/DeveloperCredit';
import { DEVELOPER } from '../src/shared/developer';

const manifest = JSON.parse(readFileSync(resolve(__dirname, '../manifest.json'), 'utf8')) as Record<string, unknown>;

describe('developer info', () => {
  it('names the developer and links to their site', () => {
    expect(DEVELOPER).toEqual({ name: 'Abhijith KM', url: 'https://abhijithkm.space/' });
  });

  it('is shown in the manifest as the extension homepage', () => {
    expect(manifest.homepage_url).toBe(DEVELOPER.url);
  });

  it('does not use an author key, which Chrome expects in a different shape', () => {
    expect(manifest).not.toHaveProperty('author');
  });

  it('only added the side panel permission, which the side panel option needs', () => {
    expect(manifest.permissions).toEqual(['storage', 'clipboardWrite', 'sidePanel']);
    expect(manifest.side_panel).toEqual({ default_path: 'panel.html' });
    expect(manifest.host_permissions).toEqual(['https://openrouter.ai/*']);
    const scripts = manifest.content_scripts as Array<{ matches: string[]; js: string[] }>;
    expect(scripts.find((s) => s.js.includes('assets/meet-content.js'))?.matches).toEqual(['https://meet.google.com/*']);
  });
});

describe('DeveloperCredit', () => {
  let container: HTMLElement | undefined;
  afterEach(() => { container?.remove(); });

  it('renders a safe external link to the developer site', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    await act(async () => { createRoot(container!).render(createElement(DeveloperCredit)); });

    expect(container.textContent).toBe('Developed by Abhijith KM');
    const link = container.querySelector('a')!;
    expect(link.textContent).toBe('Abhijith KM');
    expect(link.getAttribute('href')).toBe('https://abhijithkm.space/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });
});
