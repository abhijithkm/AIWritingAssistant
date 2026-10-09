import { OpenRouterProvider } from '../api/openrouter';
import { DEFAULT_MODEL, SETTINGS_KEY, type ExtensionSettings, type GenerateMessage, type GenerateReply } from '../shared/types';

chrome.runtime.onMessage.addListener((message: GenerateMessage, _sender, sendResponse: (reply: GenerateReply) => void) => {
  if (message?.type !== 'AI_WRITER_GENERATE') return false;

  void (async () => {
    try {
      if (!message.request.text.trim()) throw new Error('Select some text before asking AI Writer.');
      const stored = await chrome.storage.local.get(SETTINGS_KEY);
      const settings = stored[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined;
      const apiKey = settings?.apiKey || '';
      if (!apiKey.trim()) throw new Error('Add your OpenRouter API key in the extension settings.');
      const provider = new OpenRouterProvider(apiKey);
      const result = await provider.generate({
        ...message.request,
        model: settings?.model?.trim() || DEFAULT_MODEL,
      });
      sendResponse({ ok: true, result });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : 'AI Writer could not complete that request.' });
    }
  })();
  return true;
});
