import { describe, expect, it } from 'vitest';
import { genericEditorAdapter, type EditorBookmark } from '../src/content/editor';

describe('generic editor adapter', () => {
  it('reads and replaces only the selected textarea text', () => {
    const field = document.createElement('textarea');
    field.value = 'hello brave world';
    field.setSelectionRange(6, 11);
    const bookmark = genericEditorAdapter.capture(field);

    expect(genericEditorAdapter.getSelection(field)).toBe('brave');
    genericEditorAdapter.replaceBookmark(bookmark, 'kind');
    expect(field.value).toBe('hello kind world');
  });

  it('ignores readonly and disabled fields', () => {
    const readonly = document.createElement('textarea');
    readonly.readOnly = true;
    const disabled = document.createElement('input');
    disabled.disabled = true;
    const editable = document.createElement('input');

    expect(genericEditorAdapter.canHandle(readonly)).toBe(false);
    expect(genericEditorAdapter.canHandle(disabled)).toBe(false);
    expect(genericEditorAdapter.canHandle(editable)).toBe(true);
  });

  it('refuses to replace a textarea selection that changed since capture', () => {
    const field = document.createElement('textarea');
    field.value = 'hello brave world';
    field.setSelectionRange(6, 11);
    const bookmark = genericEditorAdapter.capture(field);

    field.value = 'goodbye brave world';
    expect(() => genericEditorAdapter.replaceBookmark(bookmark, 'kind')).toThrow('changed after you selected it');
    expect(field.value).toBe('goodbye brave world');
  });

  it('refuses to replace a contenteditable range that changed since capture', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.textContent = 'hello brave world';
    document.body.append(editor);
    const textNode = editor.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 11);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const bookmark = genericEditorAdapter.capture(editor);

    textNode.replaceData(6, 5, 'bold');
    expect(() => genericEditorAdapter.replaceBookmark(bookmark, 'kind')).toThrow('changed after you selected it');
    editor.remove();
  });

  it('replaces only the selected contenteditable range', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.textContent = 'hello brave world';
    document.body.append(editor);
    const textNode = editor.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 11);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    const bookmark: EditorBookmark = genericEditorAdapter.capture(editor);
    genericEditorAdapter.replaceBookmark(bookmark, 'kind');
    expect(editor.textContent).toBe('hello kind world');
    editor.remove();
  });
});
