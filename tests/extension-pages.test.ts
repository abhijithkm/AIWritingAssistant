import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');
const manifest = JSON.parse(read('manifest.json')) as {
  icons?: Record<string, string>;
  action?: { default_icon?: Record<string, string>; default_popup?: string };
  side_panel?: { default_path?: string };
};
const SIZES = [16, 32, 48, 128];

function pngInfo(file: string) {
  const bytes = readFileSync(resolve(root, file));
  const signature = bytes.subarray(0, 8).toString('hex');
  return { signature, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
}

describe('extension icons', () => {
  it('declares every icon size in the manifest and uses them for the toolbar button', () => {
    for (const size of SIZES) {
      expect(manifest.icons?.[String(size)]).toBe(`icons/icon-${size}.png`);
      expect(manifest.action?.default_icon?.[String(size)]).toBe(`icons/icon-${size}.png`);
    }
  });

  it.each(SIZES)('icon-%i.png is a square PNG of that size with transparency', (size) => {
    const file = `public/icons/icon-${size}.png`;
    expect(existsSync(resolve(root, file))).toBe(true);
    const info = pngInfo(file);
    expect(info.signature).toBe('89504e470d0a1a0a');
    expect([info.width, info.height]).toEqual([size, size]);
    // Colour type 6 is RGBA, so the rounded corners are transparent instead of a dark square.
    expect(info.colorType).toBe(6);
  });

  it('ships only small icon files; the source artwork stays out of the build', () => {
    for (const name of readdirSync(resolve(root, 'public/icons'))) {
      expect(statSync(resolve(root, 'public/icons', name)).size).toBeLessThan(100_000);
    }
    expect(existsSync(resolve(root, 'assets/logo-source.png'))).toBe(true);
  });
});

describe('extension pages', () => {
  it.each(['index.html', 'panel.html', 'window.html', 'report.html'])('%s uses the logo as its tab icon', (file) => {
    expect(read(file)).toContain('<link rel="icon" type="image/png" href="/icons/icon-32.png" />');
  });

  it('runs the same app in the side panel and the detached window, marked by surface', () => {
    for (const [file, surface] of [['panel.html', 'panel'], ['window.html', 'window']] as const) {
      const html = read(file);
      expect(html).toContain(`data-surface="${surface}"`);
      expect(html).toContain('src="/src/popup/main.tsx"');
    }
    expect(read('index.html')).not.toContain('data-surface');
  });

  it('points the manifest at the side panel page while keeping the toolbar popup', () => {
    expect(manifest.side_panel?.default_path).toBe('panel.html');
    expect(manifest.action?.default_popup).toBe('index.html');
  });
});
