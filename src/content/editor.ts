export interface EditorAdapter {
  canHandle(element: HTMLElement): boolean;
  getText(element: HTMLElement): string;
  getSelection(element: HTMLElement): string;
  replaceSelection(element: HTMLElement, text: string): void;
}

type Bookmark =
  | { kind: 'field'; element: HTMLTextAreaElement | HTMLInputElement; start: number; end: number; selected: string }
  | { kind: 'range'; element: HTMLElement; range: Range; selected: string };

export type EditorBookmark = Bookmark;

const STALE_SELECTION = 'The text changed after you selected it. Select it again to replace it.';

function isTextField(element: HTMLElement): element is HTMLTextAreaElement | HTMLInputElement {
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return ['text', 'search'].includes(element.type);
}

function isContentEditable(element: HTMLElement): boolean {
  return element.isContentEditable || element.getAttribute('contenteditable') === 'true';
}

function selectedRange(element: HTMLElement): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const parent = container.nodeType === Node.ELEMENT_NODE ? container as HTMLElement : container.parentElement;
  return parent && (parent === element || element.contains(parent)) ? range : null;
}

type GenericEditorAdapter = EditorAdapter & {
  capture(element: HTMLElement): EditorBookmark;
  replaceBookmark(bookmark: EditorBookmark, text: string): void;
};

export const genericEditorAdapter: GenericEditorAdapter = {
  canHandle(element: HTMLElement): boolean {
    if (isTextField(element)) return !element.readOnly && !element.disabled;
    return isContentEditable(element);
  },

  getText(element: HTMLElement): string {
    if (isTextField(element)) return element.value;
    if (isContentEditable(element)) return element.innerText || element.textContent || '';
    return '';
  },

  getSelection(element: HTMLElement): string {
    if (isTextField(element)) {
      const start = element.selectionStart;
      const end = element.selectionEnd;
      return start === null || end === null ? '' : element.value.slice(start, end);
    }
    if (isContentEditable(element)) return selectedRange(element)?.toString() || '';
    return '';
  },

  capture(element: HTMLElement): EditorBookmark {
    if (!this.canHandle(element)) throw new Error('This editor is not supported.');
    if (isTextField(element)) {
      const start = element.selectionStart;
      const end = element.selectionEnd;
      if (start === null || end === null || start === end) throw new Error('Select some text first.');
      return { kind: 'field', element, start, end, selected: element.value.slice(start, end) };
    }
    const range = selectedRange(element);
    if (!range || !range.toString()) throw new Error('Select some text first.');
    return { kind: 'range', element, range: range.cloneRange(), selected: range.toString() };
  },

  replaceBookmark(bookmark: EditorBookmark, text: string): void {
    if (bookmark.kind === 'field') {
      const { element, start, end, selected } = bookmark;
      if (element.value.slice(start, end) !== selected) throw new Error(STALE_SELECTION);
      element.setRangeText(text, start, end, 'select');
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const range = bookmark.range;
    if (range.toString() !== bookmark.selected) throw new Error(STALE_SELECTION);
    range.deleteContents();
    const replacement = document.createTextNode(text);
    range.insertNode(replacement);
    range.setStartAfter(replacement);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    bookmark.element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  },

  replaceSelection(element: HTMLElement, text: string): void {
    this.replaceBookmark(this.capture(element), text);
  },
};
