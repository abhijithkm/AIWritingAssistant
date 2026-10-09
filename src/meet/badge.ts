import type { MeetSnapshot } from './types';

const styles = `
  :host { all: initial; position: fixed; top: 12px; left: 12px; z-index: 2147483647; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2233; }
  * { box-sizing: border-box; }
  .ui { display: flex; align-items: center; gap: 10px; max-width: 320px; padding: 8px 8px 8px 12px; border: 1px solid #d9dbe6; border-radius: 12px; background: #fff; box-shadow: 0 6px 20px #1f223338; }
  .dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: #1f9d55; box-shadow: 0 0 0 3px #1f9d5533; }
  .text { min-width: 0; font-size: 12px; line-height: 1.4; }
  .title { font-size: 13px; font-weight: 700; }
  .sub, .note { color: #565b6e; overflow-wrap: anywhere; }
  .note { color: #8a4b00; }
  .stop { flex: none; min-height: 32px; padding: 0 12px; border: 1px solid #8b90a5; border-radius: 8px; background: #fff; color: #1f2233; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
  .stop:hover { border-color: #5b47d6; background: #f1eeff; }
  .stop:focus-visible { outline: 2px solid #5b47d6; outline-offset: 2px; }
  [hidden] { display: none; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The always-visible "assistant active" indicator, with a Stop button, shown on the Meet page. */
export class Badge {
  private host: HTMLDivElement | null = null;
  private fields: { sub: HTMLElement; note: HTMLElement } | null = null;

  constructor(private readonly handlers: { onStop(): void }) {}

  update(snapshot: MeetSnapshot): void {
    if (snapshot.phase !== 'active') {
      if (this.host) this.host.style.display = 'none';
      return;
    }
    const { host, fields } = this.mount();
    host.style.display = 'block';

    const lines = `${snapshot.entryCount} ${snapshot.entryCount === 1 ? 'line' : 'lines'}`;
    const working = Object.values(snapshot.busy).some(Boolean);
    fields.sub.textContent = `Reading visible captions · ${lines}${working ? ' · AI is working…' : ''}`;

    const captions = snapshot.page.captions;
    fields.note.hidden = captions === 'on';
    fields.note.textContent = captions === 'off'
      ? 'Turn on captions in Meet to capture the transcript.'
      : 'Waiting for captions — turn them on in Meet if needed.';
  }

  // Built on first use so pages where the assistant never starts get no extra DOM.
  private mount(): { host: HTMLDivElement; fields: { sub: HTMLElement; note: HTMLElement } } {
    if (this.host && this.fields) return { host: this.host, fields: this.fields };

    const host = document.createElement('div');
    host.setAttribute('data-ai-writer-meet-badge', '');
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = styles;

    const ui = el('div', 'ui');
    ui.setAttribute('role', 'status');
    ui.setAttribute('aria-live', 'polite');
    const text = el('div', 'text');
    const sub = el('div', 'sub');
    const note = el('div', 'note');
    text.append(el('div', 'title', 'Meet Assistant active'), sub, note);

    const stop = el('button', 'stop', 'Stop');
    stop.type = 'button';
    stop.setAttribute('aria-label', 'Stop Meet Assistant');
    stop.addEventListener('click', () => this.handlers.onStop());

    ui.append(el('span', 'dot'), text, stop);
    root.append(style, ui);
    document.documentElement.append(host);

    this.host = host;
    this.fields = { sub, note };
    return { host, fields: this.fields };
  }
}
