import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SurfaceButtons from '../src/popup/SurfaceButtons';
import * as surface from '../src/popup/surface';

vi.mock('../src/popup/surface', () => ({
  currentSurface: vi.fn(() => 'popup'),
  activeTargetTab: vi.fn(),
  openSidePanel: vi.fn(),
  openDetachedWindow: vi.fn(),
  closeSurface: vi.fn(),
}));

describe('SurfaceButtons', () => {
  let container: HTMLElement;
  let root: Root;
  let onError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.mocked(surface.openSidePanel).mockResolvedValue(undefined);
    vi.mocked(surface.openDetachedWindow).mockResolvedValue(undefined);
    vi.mocked(surface.closeSurface).mockResolvedValue(undefined);
    onError = vi.fn();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const labels = () => Array.from(container.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
  const byLabel = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  async function mount(surfaceName: 'popup' | 'panel' | 'window') {
    await act(async () => { root.render(createElement(SurfaceButtons, { surface: surfaceName, onError })); });
  }

  it('in the toolbar popup offers the side panel and a separate window, but no close button', async () => {
    await mount('popup');
    expect(labels()).toEqual(['Open in side panel', 'Open in a window']);
  });

  it('in the side panel offers a separate window and a close button', async () => {
    await mount('panel');
    expect(labels()).toEqual(['Open in a window', 'Close panel']);
  });

  it('in a separate window offers the side panel and a close button', async () => {
    await mount('window');
    expect(labels()).toEqual(['Open in side panel', 'Close window']);
  });

  it('gives every icon button a tooltip as well as an accessible name', async () => {
    await mount('popup');
    for (const button of container.querySelectorAll('button')) {
      expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'));
    }
  });

  it('opens the side panel, the window, or closes the surface when clicked', async () => {
    await mount('popup');
    await act(async () => { byLabel('Open in side panel').click(); });
    expect(surface.openSidePanel).toHaveBeenCalledWith('popup');
    await act(async () => { byLabel('Open in a window').click(); });
    expect(surface.openDetachedWindow).toHaveBeenCalledWith('popup');

    await mount('panel');
    await act(async () => { byLabel('Close panel').click(); });
    expect(surface.closeSurface).toHaveBeenCalledWith('panel');
  });

  it('reports the reason when Chrome cannot open the requested surface', async () => {
    vi.mocked(surface.openSidePanel).mockRejectedValue(new Error('The side panel is not available in this version of Chrome.'));
    await mount('popup');
    await act(async () => { byLabel('Open in side panel').click(); });
    expect(onError).toHaveBeenCalledWith('The side panel is not available in this version of Chrome.');
  });

  it('clears an earlier error when the next attempt works', async () => {
    vi.mocked(surface.openDetachedWindow).mockRejectedValueOnce(new Error('The window could not be opened.'));
    await mount('popup');
    await act(async () => { byLabel('Open in a window').click(); });
    await act(async () => { byLabel('Open in a window').click(); });
    expect(onError).toHaveBeenNthCalledWith(1, 'The window could not be opened.');
    expect(onError).toHaveBeenLastCalledWith('');
  });
});
