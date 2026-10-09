import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DEFAULT_MODEL, SETTINGS_KEY, USER_NAME_KEY, type ExtensionSettings, type WritingMode } from '../shared/types';
import { rewriteText } from './ai-writer-client';
import DeveloperCredit from './DeveloperCredit';
import { ChevronLeftIcon, GearIcon, MicIcon, SparkleIcon } from './icons';
import MeetPanel from './MeetPanel';
import { pollMeetState } from './meet-client';
import SurfaceButtons from './SurfaceButtons';
import { currentSurface } from './surface';

type SaveState = 'loading' | 'saved' | 'unsaved' | 'saving' | 'error';

const modes: Array<{ value: WritingMode; label: string }> = [
  { value: 'rewrite', label: 'Rewrite' },
  { value: 'grammar', label: 'Grammar' },
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'shorten', label: 'Shorten' },
  { value: 'expand', label: 'Expand' },
];

const saveLabels: Record<SaveState, string> = {
  loading: 'Loading',
  saved: 'Saved',
  unsaved: 'Not saved',
  saving: 'Saving',
  error: 'Error',
};

export default function App() {
  const [screen, setScreen] = useState<'writer' | 'settings'>('writer');
  const [module, setModule] = useState<'writer' | 'meet'>('writer');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [userName, setUserName] = useState('');
  // Where the app is running (toolbar popup, side panel or window) and why moving it failed, if it did.
  const [surface] = useState(() => currentSurface());
  const [surfaceError, setSurfaceError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [settingsError, setSettingsError] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);

  const [inputText, setInputText] = useState('');
  const [mode, setMode] = useState<WritingMode>('rewrite');
  const [result, setResult] = useState('');
  const [requestError, setRequestError] = useState('');
  const [isRewriting, setIsRewriting] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  // Opening the popup on a Meet tab lands on Meet. The user's own choice or typing always wins.
  const choseModule = useRef(false);
  const typedText = useRef(false);
  typedText.current = inputText !== '';
  useEffect(() => {
    void pollMeetState().then(() => {
      if (!choseModule.current && !typedText.current) setModule('meet');
    }).catch(() => undefined);
  }, []);
  const pickModule = (next: 'writer' | 'meet') => {
    choseModule.current = true;
    setModule(next);
  };

  useEffect(() => {
    void chrome.storage.local.get([SETTINGS_KEY, USER_NAME_KEY]).then((stored) => {
      const settings = stored[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined;
      setApiKey(settings?.apiKey || '');
      setModel(settings?.model || DEFAULT_MODEL);
      setUserName(typeof stored[USER_NAME_KEY] === 'string' ? stored[USER_NAME_KEY] : '');
      setHasApiKey(!!settings?.apiKey);
      setSaveState(settings?.apiKey ? 'saved' : 'unsaved');
    }).catch(() => {
      setSaveState('error');
      setSettingsError('Could not read extension settings. Try reloading the popup.');
    });
  }, []);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveState('saving');
    setSettingsError('');
    try {
      const settings: ExtensionSettings = { apiKey: apiKey.trim(), model: model.trim() || DEFAULT_MODEL };
      const name = userName.trim();
      await chrome.storage.local.set({ [SETTINGS_KEY]: settings, [USER_NAME_KEY]: name });
      setApiKey(settings.apiKey);
      setModel(settings.model);
      setUserName(name);
      setHasApiKey(!!settings.apiKey);
      setSaveState(settings.apiKey ? 'saved' : 'unsaved');
    } catch {
      setSaveState('error');
      setSettingsError('Settings could not be saved. Please try again.');
    }
  }

  async function runRewrite() {
    if (isRewriting || !inputText.trim()) return;
    setIsRewriting(true);
    setRequestError('');
    setResult('');
    setCopyState('idle');
    try {
      setResult(await rewriteText(inputText, mode));
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'AI Writer could not complete that request.');
    } finally {
      setIsRewriting(false);
    }
  }

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(result);
      setCopyState('copied');
    } catch {
      setRequestError('Clipboard access was denied. Select and copy the result manually.');
    }
  }

  if (screen === 'settings') {
    return (
      <main className="popup-shell">
        <header className="brand-row">
          <button className="icon-button" type="button" onClick={() => setScreen('writer')} aria-label="Back to writer" title="Back"><ChevronLeftIcon /></button>
          <div><h1>Settings</h1><p className="muted">Connect your OpenRouter account.</p></div>
        </header>

        <form className="card" onSubmit={saveSettings}>
          <div className="card-heading">
            <div><h2>OpenRouter</h2><p className="muted">Your key stays in this Chrome profile.</p></div>
            <span className={`status status-${saveState}`}><i />{saveLabels[saveState]}</span>
          </div>

          <label htmlFor="api-key">OpenRouter API key</label>
          <input
            id="api-key"
            type="password"
            autoComplete="off"
            placeholder="sk-or-v1-…"
            value={apiKey}
            onChange={(event) => { setApiKey(event.target.value); if (saveState !== 'loading') setSaveState('unsaved'); }}
          />

          <label htmlFor="model">Model</label>
          <input
            id="model"
            type="text"
            value={model}
            onChange={(event) => { setModel(event.target.value); if (saveState !== 'loading') setSaveState('unsaved'); }}
          />
          <p className="muted hint">Use <code>openrouter/free</code> to route to a free model.</p>

          <label htmlFor="user-name">Your name (optional)</label>
          <input
            id="user-name"
            type="text"
            autoComplete="name"
            value={userName}
            onChange={(event) => { setUserName(event.target.value); if (saveState !== 'loading') setSaveState('unsaved'); }}
          />
          <p className="muted hint">Meet Assistant signs follow-up emails with it and uses it to understand &quot;You&quot; in captions.</p>

          {settingsError && <p className="error-message" role="alert">{settingsError}</p>}
          <button className="primary-button" type="submit" disabled={saveState === 'loading' || saveState === 'saving'}>
            {saveState === 'saving' ? 'Saving…' : 'Save settings'}
          </button>
        </form>
        <footer>Private prototype. Keep your API key private.</footer>
        <DeveloperCredit />
      </main>
    );
  }

  const header = (
    <header className="brand-row">
      <img className="brand-logo" src="/icons/icon-128.png" alt="" width={40} height={40} />
      <h1>AI Writer</h1>
      {saveState !== 'loading' && (hasApiKey
        ? <span className="status status-saved"><i />Ready</span>
        : <button className="status status-action" type="button" onClick={() => setScreen('settings')}>Add API key</button>)}
      <button className="icon-button" type="button" onClick={() => setScreen('settings')} aria-label="Open settings" title="Settings"><GearIcon /></button>
    </header>
  );

  const moduleNav = (
    <>
      <div className="nav-row">
        <nav className="module-nav" aria-label="AI Writer sections">
          <button className="module-tab" type="button" aria-current={module === 'writer' ? 'page' : undefined} onClick={() => pickModule('writer')}><SparkleIcon />Writer</button>
          <button className="module-tab" type="button" aria-current={module === 'meet' ? 'page' : undefined} onClick={() => pickModule('meet')}><MicIcon />Meet</button>
        </nav>
        <SurfaceButtons surface={surface} onError={setSurfaceError} />
      </div>
      {surfaceError && <p className="error-message surface-error" role="alert">{surfaceError}</p>}
    </>
  );

  if (module === 'meet') {
    return (
      <main className="popup-shell">
        {header}
        {moduleNav}
        <MeetPanel onOpenSettings={() => setScreen('settings')} />
        <DeveloperCredit />
      </main>
    );
  }

  return (
    <main className="popup-shell">
      {header}
      {moduleNav}

      <section className="card" aria-label="Writing workspace">
        <label htmlFor="writing-input">Your text</label>
        <textarea
          id="writing-input"
          className="writing-input"
          placeholder="Paste or type text here…"
          value={inputText}
          disabled={isRewriting}
          autoFocus
          onChange={(event) => { setInputText(event.target.value); setResult(''); setRequestError(''); setCopyState('idle'); }}
        />

        <div className="rewrite-controls">
          <label htmlFor="writing-mode">Mode</label>
          <select id="writing-mode" value={mode} disabled={isRewriting} onChange={(event) => setMode(event.target.value as WritingMode)}>
            {modes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>

        <button className="primary-button" type="button" disabled={isRewriting || !inputText.trim()} onClick={() => void runRewrite()}>
          {isRewriting ? <><span className="spinner" aria-hidden="true" />Rewriting…</> : 'Rewrite'}
        </button>

        {requestError && <p className="error-message request-error" role="alert">{requestError}</p>}

        <div aria-live="polite">
          {result && (
            <section className="result-section" aria-label="Rewritten result">
              <h2>Your rewrite</h2>
              <textarea className="writing-result" aria-label="Rewritten text" readOnly value={result} />
              <div className="result-actions">
                <button className="secondary-button" type="button" onClick={() => { setInputText(result); setResult(''); setCopyState('idle'); }}>Replace input</button>
                <button className="secondary-button" type="button" onClick={() => void copyResult()}>{copyState === 'copied' ? 'Copied' : 'Copy'}</button>
                <button className="secondary-button" type="button" disabled={isRewriting} onClick={() => void runRewrite()}>Retry</button>
              </div>
            </section>
          )}
        </div>
      </section>

      <footer>Text is cleared when this window closes.</footer>
      <DeveloperCredit />
    </main>
  );
}
