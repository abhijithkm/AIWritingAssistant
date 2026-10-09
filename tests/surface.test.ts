import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeTargetTab, closeSurface, currentSurface, openDetachedWindow, openSidePanel } from '../src/popup/surface';

type Overrides = Record<string, unknown>;

function stubChrome(overrides: Overrides = {}) {
  const stub = {
    windows: {
      getCurrent: vi.fn(async () => ({ id: 1, type: 'normal' })),
      getLastFocused: vi.fn(async () => ({ id: 2, type: 'normal' })),
      create: vi.fn(async () => ({ id: 9 })),
      update: vi.fn(async () => ({})),
      remove: vi.fn(async () => undefined),
    },
    tabs: { query: vi.fn(async () => [{ id: 7 }]) },
    sidePanel: { open: vi.fn(async () => undefined) },
    runtime: { getURL: (path: string) => `chrome-extension://abc/${path}` },
    ...overrides,
  };
  vi.stubGlobal('chrome', stub);
  return stub;
}

describe('surface helpers', () => {
  let close: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.surface;
  });

  describe('currentSurface', () => {
    it('reads where the app is running from the page itself', () => {
      expect(currentSurface()).toBe('popup');
      document.documentElement.dataset.surface = 'panel';
      expect(currentSurface()).toBe('panel');
      document.documentElement.dataset.surface = 'window';
      expect(currentSurface()).toBe('window');
      document.documentElement.dataset.surface = 'something-else';
      expect(currentSurface()).toBe('popup');
    });
  });

  describe('activeTargetTab', () => {
    it('uses the active tab of the current window in a popup or side panel', async () => {
      const chromeStub = stubChrome();
      await expect(activeTargetTab()).resolves.toEqual({ id: 7 });
      expect(chromeStub.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    });

    it('uses the last focused browser window when running in a detached window', async () => {
      const chromeStub = stubChrome({
        windows: {
          getCurrent: vi.fn(async () => ({ id: 5, type: 'popup' })),
          getLastFocused: vi.fn(async () => ({ id: 2, type: 'normal' })),
        },
      });
      await activeTargetTab();
      expect(chromeStub.windows.getLastFocused).toHaveBeenCalledWith({ windowTypes: ['normal'] });
      expect(chromeStub.tabs.query).toHaveBeenCalledWith({ active: true, windowId: 2 });
    });

    it('falls back to the current window when the windows API is unavailable', async () => {
      const chromeStub = stubChrome({ windows: undefined });
      await activeTargetTab();
      expect(chromeStub.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    });
  });

  describe('openSidePanel', () => {
    it('opens the side panel for this window and closes the popup', async () => {
      const chromeStub = stubChrome();
      await openSidePanel('popup');
      expect(chromeStub.sidePanel.open).toHaveBeenCalledWith({ windowId: 1 });
      expect(close).toHaveBeenCalled();
    });

    it('opens it in the browser window behind a detached window, then closes the detached window', async () => {
      const chromeStub = stubChrome({
        windows: {
          getCurrent: vi.fn(async () => ({ id: 5, type: 'popup' })),
          getLastFocused: vi.fn(async () => ({ id: 2, type: 'normal' })),
          remove: vi.fn(async () => undefined),
        },
      });
      await openSidePanel('window');
      expect(chromeStub.sidePanel.open).toHaveBeenCalledWith({ windowId: 2 });
      expect(chromeStub.windows.remove).toHaveBeenCalledWith(5);
    });

    it('explains when the side panel is not available', async () => {
      stubChrome({ sidePanel: undefined });
      await expect(openSidePanel('popup')).rejects.toThrow('side panel is not available');
      expect(close).not.toHaveBeenCalled();
    });

    it('explains when Chrome refuses to open it and keeps the surface open', async () => {
      stubChrome({ sidePanel: { open: vi.fn(async () => { throw new Error('No active browser window'); }) } });
      await expect(openSidePanel('popup')).rejects.toThrow('could not be opened');
      expect(close).not.toHaveBeenCalled();
    });
  });

  describe('openDetachedWindow', () => {
    it('opens the app in a separate window and closes the popup', async () => {
      const chromeStub = stubChrome({ tabs: { query: vi.fn(async () => []) } });
      await openDetachedWindow('popup');
      expect(chromeStub.windows.create).toHaveBeenCalledWith({
        url: 'chrome-extension://abc/window.html',
        type: 'popup',
        width: 420,
        height: 720,
      });
      expect(close).toHaveBeenCalled();
    });

    it('focuses the window that is already open instead of opening a second one', async () => {
      const chromeStub = stubChrome({ tabs: { query: vi.fn(async () => [{ id: 3, windowId: 8 }]) } });
      await openDetachedWindow('panel');
      expect(chromeStub.tabs.query).toHaveBeenCalledWith({ url: 'chrome-extension://abc/window.html' });
      expect(chromeStub.windows.update).toHaveBeenCalledWith(8, { focused: true });
      expect(chromeStub.windows.create).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalled();
    });

    it('explains when the window could not be opened and keeps the surface open', async () => {
      stubChrome({
        tabs: { query: vi.fn(async () => []) },
        windows: { create: vi.fn(async () => { throw new Error('boom'); }) },
      });
      await expect(openDetachedWindow('popup')).rejects.toThrow('could not be opened');
      expect(close).not.toHaveBeenCalled();
    });
  });

  describe('closeSurface', () => {
    it('removes the detached window itself', async () => {
      const chromeStub = stubChrome({ windows: { getCurrent: vi.fn(async () => ({ id: 5, type: 'popup' })), remove: vi.fn(async () => undefined) } });
      await closeSurface('window');
      expect(chromeStub.windows.remove).toHaveBeenCalledWith(5);
    });

    it('closes the side panel and the popup with window.close', async () => {
      stubChrome();
      await closeSurface('panel');
      await closeSurface('popup');
      expect(close).toHaveBeenCalledTimes(2);
    });
  });
});
