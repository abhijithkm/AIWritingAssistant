export type WritingMode = 'rewrite' | 'grammar' | 'professional' | 'casual' | 'shorten' | 'expand';

export interface AIRequest {
  text: string;
  // Writer requests pick their instructions by mode; other features pass `system` explicitly.
  mode?: WritingMode;
  system?: string;
  temperature?: number;
  model?: string;
}

export interface AIResponse {
  text: string;
}

export interface AIProvider {
  generate(request: AIRequest): Promise<AIResponse>;
}

export interface ExtensionSettings {
  apiKey: string;
  model: string;
}

export interface GenerateMessage {
  type: 'AI_WRITER_GENERATE';
  request: AIRequest;
}

export interface GenerateSuccess {
  ok: true;
  result: AIResponse;
}

export interface GenerateFailure {
  ok: false;
  error: string;
}

export type GenerateReply = GenerateSuccess | GenerateFailure;

export const DEFAULT_MODEL = 'openrouter/free';
export const SETTINGS_KEY = 'aiWriterSettings';
// The optional display name lives under its own key so content scripts can read it without ever
// loading SETTINGS_KEY, which holds the API key. Meet Assistant uses it to resolve "You" in captions
// and to sign follow-up emails.
export const USER_NAME_KEY = 'aiWriterUserName';
