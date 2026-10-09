// The app runs in three places: the toolbar popup, the side panel (panel.html) and a detached
// window (window.html). The two persistent ones set data-surface on <html>.
export type Surface = 'popup' | 'panel' | 'window';

const WINDOW_PAGE = 'window.html';
const WINDOW_SIZE = { width: 420, height: 720 };

export function currentSurface(doc: Document = document): Surface {
  const surface = doc.documentElement.dataset.surface;
  return surface === 'panel' || surface === 'window' ? surface : 'popup';
}

// A detached window is not a browser window with tabs, so "the page I am about" means the last
// focused normal browser window, not the window this app is in.
async function targetBrowserWindowId(): Promise<number | undefined> {
  const current = await chrome.windows.getCurrent();
  if (current.type === 'normal') return current.id;
  return (await chrome.windows.getLastFocused({ windowTypes: ['normal'] })).id;
}

/** The tab Meet Assistant should talk to: the active tab of the browser window this app belongs to or sits beside. */
export async function activeTargetTab(): Promise<chrome.tabs.Tab | undefined> {
  if (!chrome.windows) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }
  const current = await chrome.windows.getCurrent();
  if (current.type === 'normal') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }
  const last = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  const [tab] = await chrome.tabs.query({ active: true, windowId: last.id });
  return tab;
}

export async function closeSurface(surface: Surface): Promise<void> {
  if (surface === 'window') {
    const current = await chrome.windows.getCurrent();
    if (current.id !== undefined) await chrome.windows.remove(current.id);
    return;
  }
  window.close();
}

/** Opens the side panel in the browser window and closes the surface the user clicked from. */
export async function openSidePanel(surface: Surface): Promise<void> {
  if (!chrome.sidePanel?.open) throw new Error('The side panel is not available in this version of Chrome.');
  try {
    const windowId = await targetBrowserWindowId();
    if (windowId === undefined) throw new Error('No browser window.');
    await chrome.sidePanel.open({ windowId });
  } catch {
    throw new Error('The side panel could not be opened. Click the page once and try again.');
  }
  await closeSurface(surface);
}

/** Opens the app in its own window (or focuses it if it is already open) and closes the surface the user clicked from. */
export async function openDetachedWindow(surface: Surface): Promise<void> {
  try {
    const url = chrome.runtime.getURL(WINDOW_PAGE);
    const [existing] = await chrome.tabs.query({ url });
    if (existing?.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
    else await chrome.windows.create({ url, type: 'popup', ...WINDOW_SIZE });
  } catch {
    throw new Error('The window could not be opened.');
  }
  await closeSurface(surface);
}
