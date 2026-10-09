import type { GenerateReply, WritingMode } from '../shared/types';
import type { EditorBookmark } from './editor';

const modes: Array<{ mode: WritingMode; label: string }> = [
  { mode: 'rewrite', label: 'Rewrite' },
  { mode: 'grammar', label: 'Grammar' },
  { mode: 'professional', label: 'Professional' },
  { mode: 'casual', label: 'Casual' },
  { mode: 'shorten', label: 'Shorten' },
  { mode: 'expand', label: 'Expand' },
];

type RequestHandler = (text: string, mode: WritingMode) => Promise<GenerateReply>;
type ReplaceHandler = (bookmark: EditorBookmark, text: string) => void;

const styles = `
  :host { all: initial; position: fixed; z-index: 2147483647; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2233; }
  * { box-sizing: border-box; }
  button { font: inherit; cursor: pointer; transition: background-color .15s, border-color .15s; }
  button:focus-visible { outline: 2px solid #5b47d6; outline-offset: 2px; }
  svg { display: block; }
  .trigger { display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 50%; background: #5b47d6; box-shadow: 0 4px 14px #1f223340; color: #fff; }
  .trigger:hover { background: #4a39b8; }
  .card { width: 260px; padding: 14px; border: 1px solid #d9dbe6; border-radius: 12px; background: #fff; box-shadow: 0 12px 32px #1f223338; }
  .card.result { width: 288px; }
  .title { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font-size: 14px; font-weight: 700; }
  .subtitle { margin: 0 0 12px; color: #565b6e; font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
  .modes { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .mode, .action { border: 1px solid #8b90a5; border-radius: 8px; background: #fff; color: #1f2233; font-size: 13px; font-weight: 600; }
  .mode { min-height: 36px; padding: 6px 10px; text-align: left; }
  .mode:hover, .action:hover { border-color: #5b47d6; background: #f1eeff; }
  .result-text { max-height: 180px; overflow: auto; margin: 8px 0 12px; padding: 10px; border-radius: 8px; background: #f3f4f8; font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
  .error { margin: 8px 0 12px; color: #a52f2f; font-size: 13px; line-height: 1.45; }
  .actions { display: flex; gap: 6px; }
  .action { flex: 1; min-height: 36px; padding: 6px; }
  .action.primary { border-color: #5b47d6; background: #5b47d6; color: #fff; }
  .action.primary:hover { background: #4a39b8; }
  .spinner { width: 14px; height: 14px; border: 2px solid #5b47d6; border-right-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } button { transition: none; } }
`;

const SVG_NS = 'http://www.w3.org/2000/svg';
const SPARKLE_PATH = 'm12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z';

function sparkleIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', SPARKLE_PATH);
  svg.append(path);
  return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class FloatingButton {
  private host: HTMLDivElement | null = null;
  private root: ShadowRoot | null = null;
  private bookmark: EditorBookmark | null = null;
  private selectedText = '';
  private mode: WritingMode = 'rewrite';
  private state: 'trigger' | 'menu' | 'loading' | 'result' | 'error' = 'trigger';
  private result = '';
  private error = '';
  private anchor = { left: 0, top: 0, bottom: 0 };
  private busy = false;
  private pending: { element: HTMLElement; text: string } | null = null;
  private dismissed = true;

  constructor(private readonly request: RequestHandler, private readonly replace: ReplaceHandler) {}

  // The content script runs in every frame, so only frames with a real selection get a host element.
  private mount(): { host: HTMLDivElement; root: ShadowRoot } {
    if (!this.host || !this.root) {
      this.host = document.createElement('div');
      this.root = this.host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = styles;
      this.root.append(style);
      this.host.setAttribute('aria-live', 'polite');
      document.documentElement.append(this.host);
    }
    return { host: this.host, root: this.root };
  }

  show(bookmark: EditorBookmark, selectedText: string, rect: DOMRect): void {
    // Key presses and selection events re-fire for the same selection; keep an open card as it is.
    if (!this.dismissed && this.state !== 'trigger' && this.isSelection(bookmark.element, selectedText)) return;

    // A brief hide/show of the same selection (window refocus, other extensions) must not lose a pending answer.
    const resumesRequest = this.busy && this.pending?.element === bookmark.element && this.pending.text === selectedText;

    this.dismissed = false;
    this.bookmark = bookmark;
    this.selectedText = selectedText;
    this.anchor = { left: rect.left, top: rect.top, bottom: rect.bottom };
    this.state = resumesRequest ? 'loading' : 'trigger';
    this.render();
  }

  private isSelection(element: HTMLElement, text: string): boolean {
    return this.bookmark?.element === element && this.selectedText === text;
  }

  hide(): void {
    this.dismissed = true;
    if (this.host) this.host.style.display = 'none';
    this.bookmark = null;
  }

  contains(node: Node | null): boolean { return !!node && !!this.host?.contains(node); }

  private async generate(mode: WritingMode): Promise<void> {
    const bookmark = this.bookmark;
    const text = this.selectedText;
    if (this.busy || !bookmark || !text.trim()) return;
    this.busy = true;
    this.pending = { element: bookmark.element, text };
    this.mode = mode;
    this.state = 'loading';
    this.render();

    let result = '';
    let error = '';
    try {
      const reply = await this.request(text, mode);
      if (!reply.ok) throw new Error(reply.error);
      result = reply.result.text;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'AI Writer could not complete that request.';
    }
    this.busy = false;
    this.pending = null;

    // The selection changed or the card was dismissed while waiting: drop the stale answer.
    if (!this.isSelection(bookmark.element, text)) return;
    this.result = result;
    this.error = error;
    this.state = error ? 'error' : 'result';
    this.render();
  }

  private addButton(parent: HTMLElement, label: string, className: string, action: () => void): HTMLButtonElement {
    const button = el('button', className, label);
    button.type = 'button';
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', action);
    parent.append(button);
    return button;
  }

  private showError(message: string): void {
    this.error = message;
    this.state = 'error';
    this.render();
  }

  private replaceSelection(): void {
    if (!this.bookmark) return;
    try {
      this.replace(this.bookmark, this.result);
      this.hide();
    } catch (caught) {
      this.showError(caught instanceof Error ? caught.message : 'AI Writer could not replace the text.');
    }
  }

  private copyResult(button: HTMLButtonElement): void {
    navigator.clipboard.writeText(this.result)
      .then(() => { button.textContent = 'Copied'; })
      .catch(() => this.showError('Clipboard access was denied. Select and copy the result manually.'));
  }

  private render(): void {
    if (this.dismissed) return;
    const { host, root } = this.mount();
    host.style.display = 'block';
    root.querySelector('.ui')?.remove();

    const ui = el('div', 'ui');
    if (this.state === 'trigger') {
      const trigger = this.addButton(ui, '', 'trigger', () => { this.state = 'menu'; this.render(); });
      trigger.setAttribute('aria-label', 'Open AI Writer');
      trigger.append(sparkleIcon());
    } else if (this.state === 'menu' || this.state === 'loading') {
      ui.append(this.renderChoice());
    } else {
      ui.append(this.renderOutcome());
    }
    root.append(ui);
    this.place(host, ui);
  }

  // Sit next to the selection; when the card does not fit below it, open it above instead.
  private place(host: HTMLElement, ui: HTMLElement): void {
    const margin = 8;
    const width = ui.offsetWidth || 300;
    const height = ui.offsetHeight || (this.state === 'trigger' ? 40 : 200);
    const below = this.anchor.bottom + margin;
    const above = this.anchor.top - height - margin;
    let top = below;
    if (below + height > window.innerHeight - margin) top = above >= margin ? above : window.innerHeight - height - margin;
    host.style.left = `${Math.max(margin, Math.min(this.anchor.left, window.innerWidth - width - margin))}px`;
    host.style.top = `${Math.max(margin, top)}px`;
  }

  private renderChoice(): HTMLElement {
    const card = el('section', 'card');
    const title = el('p', 'title');
    if (this.state === 'loading') {
      title.append(el('span', 'spinner'), 'Rewriting…');
      card.append(title, el('p', 'subtitle', 'Working on your selection.'));
      return card;
    }
    title.textContent = 'AI Writer';
    const preview = this.selectedText.length > 45 ? `${this.selectedText.slice(0, 45)}…` : this.selectedText;
    card.append(title, el('p', 'subtitle', `Selected: “${preview}”`));
    const grid = el('div', 'modes');
    for (const item of modes) this.addButton(grid, item.label, 'mode', () => void this.generate(item.mode));
    card.append(grid);
    return card;
  }

  private renderOutcome(): HTMLElement {
    const card = el('section', 'card result');
    const failed = this.state === 'error';
    card.append(el('p', 'title', failed ? 'Couldn’t finish' : 'Your rewrite'));
    card.append(failed ? el('p', 'error', this.error) : el('p', 'result-text', this.result));

    const actions = el('div', 'actions');
    if (failed) {
      this.addButton(actions, 'Retry', 'action', () => void this.generate(this.mode));
      this.addButton(actions, 'Close', 'action', () => this.hide());
    } else {
      this.addButton(actions, 'Replace', 'action primary', () => this.replaceSelection());
      const copy = this.addButton(actions, 'Copy', 'action', () => this.copyResult(copy));
      this.addButton(actions, 'Retry', 'action', () => void this.generate(this.mode));
    }
    card.append(actions);
    return card;
  }
}
