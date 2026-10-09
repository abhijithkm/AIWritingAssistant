import { genericEditorAdapter } from './editor';
import { FloatingButton } from './floating-button';
import type { GenerateMessage, GenerateReply, WritingMode } from '../shared/types';

async function requestRewrite(text: string, mode: WritingMode): Promise<GenerateReply> {
  let reply: GenerateReply | undefined;
  try {
    reply = await chrome.runtime.sendMessage<GenerateMessage, GenerateReply>({
      type: 'AI_WRITER_GENERATE',
      request: { text, mode },
    });
  } catch {
    // Thrown when the extension was reloaded after this page loaded and its old script is orphaned.
    throw new Error('AI Writer was updated or reloaded. Refresh this page and try again.');
  }
  if (!reply || typeof reply !== 'object' || !('ok' in reply)) {
    throw new Error('AI Writer did not return a usable result. Please retry.');
  }
  return reply;
}

const widget = new FloatingButton(
  requestRewrite,
  (bookmark, text) => genericEditorAdapter.replaceBookmark(bookmark, text),
);

let updateQueued = false;

function activeEditor(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && genericEditorAdapter.canHandle(active) ? active : null;
}

function selectionRect(element: HTMLElement): DOMRect {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const rect = element.getBoundingClientRect();
    return new DOMRect(rect.left + Math.min(rect.width / 2, 24), rect.top, 0, rect.height);
  }
  const selection = window.getSelection();
  if (selection?.rangeCount) {
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width || rect.height) return rect;
  }
  return element.getBoundingClientRect();
}

function updateForSelection(): void {
  updateQueued = false;
  const element = activeEditor();
  const selected = element ? genericEditorAdapter.getSelection(element) : '';
  if (!element || !selected.trim()) {
    widget.hide();
    return;
  }
  try {
    widget.show(genericEditorAdapter.capture(element), selected, selectionRect(element));
  } catch {
    widget.hide();
  }
}

function queueUpdate(): void {
  if (updateQueued) return;
  updateQueued = true;
  requestAnimationFrame(updateForSelection);
}

document.addEventListener('selectionchange', queueUpdate);
document.addEventListener('mouseup', queueUpdate, true);
document.addEventListener('keyup', queueUpdate, true);
document.addEventListener('focusin', queueUpdate, true);
document.addEventListener('pointerdown', (event) => {
  if (!widget.contains(event.target as Node)) widget.hide();
}, true);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') widget.hide();
}, true);
