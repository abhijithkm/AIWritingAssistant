# AI Writer

A private Chrome Manifest V3 prototype with two modules that share one OpenRouter connection:

- **Writer** rewrites selected text in textareas, text/search inputs, and contenteditable regions.
- **Meet Assistant** reads the captions Google Meet shows on screen, keeps a local transcript, and on request produces summaries, action items, decisions, open questions, answers about the meeting, and a follow-up email.

Open the popup and use the **Writer** / **Meet** switch at the top. The popup opens on **Meet** when the active tab is a Google Meet page.

## Prerequisites

- Node.js 20 or newer and npm
- Google Chrome
- An OpenRouter API key with access to `openrouter/free`

## Install and build

From this project directory:

```sh
npm install
npm run typecheck
npm test
npm run build
```

The production extension is written to `dist/`. `npm run build` produces the popup, the service worker, the Writer content script (`content.js`) and the Meet content script (`meet-content.js`).

No linter is configured in this project, so the checks are `npm run typecheck`, `npm test` and `npm run build`.

## Load in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select this project's `dist` folder.
5. Pin **AI Writer** from the Extensions menu for quick access to the writing window.

After rebuilding, use the reload button on the AI Writer card in `chrome://extensions` to load the new build.

## Configure OpenRouter

1. Open the AI Writer popup from Chrome's toolbar.
2. Open **Settings** using the gear button.
3. Paste your OpenRouter API key into **OpenRouter API Key**.
4. Leave **Model** set to `openrouter/free`, or enter another OpenRouter model slug.
5. Optionally enter **Your name**. Meet Assistant signs follow-up emails with it and uses it to understand "You" in captions. It is stored under its own key, so the Meet content script reads the name without ever loading the settings that hold your API key.
6. Select **Save settings** and confirm the **Saved** status.

Writer and Meet Assistant both use this one key and model. The key is saved in `chrome.storage.local` for this Chrome profile. It is never included in the source, sent to the page, or written to logs. The service worker reads it only when it makes an OpenRouter request.

## Try it

1. Open AI Writer from the Chrome toolbar.
2. Paste or type text in the writing window, choose one of the six modes, then select **Rewrite**.
3. Review the result. **Replace input** puts the result back into the editor; **Copy** copies it; **Retry** requests another version.

You can also visit a regular `http://` or `https://` page, select text in a textarea, text/search input, or contenteditable editor, and use the floating ✨ button. In either flow, text and results stay in memory only and are cleared when the popup closes; only settings are saved.

The first request may take longer while OpenRouter routes `openrouter/free` to an available model. The selected text is sent to OpenRouter when a writing mode is requested.

## Keep it open: side panel or window

A toolbar popup closes as soon as you click anywhere else, and Chrome offers no way to prevent that. Two icon buttons next to the **Writer / Meet** switch move the app somewhere that stays open:

- **Open in side panel** docks it beside the page. It stays open while you click the page or switch tabs, and it follows the active tab, so Meet Assistant shows whichever Meet tab you are on. Close it with the **×** button or Chrome's own close button. Needs Chrome 114 or newer (116 or newer to open it from the button; on older versions use Chrome's side panel menu).
- **Open in a window** opens a small separate window. It talks to the last browser window you used, not to itself. Opening it again focuses the existing window. Close it with the **×** button or the window's own close button.

Each button also closes the surface you clicked from, so the app moves instead of being duplicated. Text you typed in the Writer box is not carried over when you move, so move first and then type. The side panel is the one extra permission this needs (`sidePanel`).

## Logo

The extension icon (toolbar, `chrome://extensions`, tab icons and the popup header) is generated from `assets/logo-source.png`. To change it, replace that file and run `powershell -File scripts/make-icons.ps1` (Windows), which rewrites `public/icons/icon-16|32|48|128.png` with transparent rounded corners. The source image stays out of the build.

## Meet Assistant

### How it works

1. Join a meeting at `https://meet.google.com/…` and turn on captions in Meet (the **CC** button). Meet Assistant never turns them on for you.
2. Open the popup, choose **Meet**, and select **Start Assistant**. You must confirm this notice first: *"Meet Assistant processes the captions currently visible in Google Meet. AI analysis may send selected transcript text to OpenRouter."*
3. While it runs, a **Meet Assistant active** badge with a **Stop** button stays visible on the Meet page, and the popup shows **Meet Assistant active** with **Stop Assistant**.
4. The **Live** tab shows the transcript as it builds. **Summary**, **Actions**, **Decisions** and **Questions** each have a button (**Summarize**, **Find Action Items**, **Find Decisions**, **Find Questions**). Nothing is sent to OpenRouter until you press one of them or ask a question in **Ask the meeting**.
5. **Stop Assistant** stops reading captions and cancels pending AI work. The transcript stays in memory so you can still use **Copy Summary**, **Copy Transcript** and **Generate Follow-up Email**. **Discard transcript** clears it.
6. **Open full report** (on the "Meeting complete" card) opens a full-page report in a new tab: summary, action items, decisions, open questions, follow-up email, your questions and answers, and the whole transcript, with each action item or decision tied to the line it came from. The report page can copy each part, print or save as PDF, and **Delete this report**. It shows only what you already generated; run the AI buttons in the popup first, then open the report again to include new results.

### What it does with your data

- It reads only caption text that Meet renders in the page. It does not use the microphone, `MediaRecorder`, Meet's media APIs, or any audio.
- The transcript lives in memory in the Meet tab. It is not written to a database or to disk, and it is gone when you close or reload the tab. The one exception is the report: **Open full report** places a copy in `chrome.storage.session`, which is browser memory only, is cleared when Chrome closes, and is not readable by web pages or content scripts. The report page can delete it. Starting in a different meeting begins a fresh transcript.
- Text is sent to OpenRouter only when you press an AI button or ask a question. Each analysis sends the lines that are new or have grown since it last ran (chunked into roughly 8 minute pieces), so a first **Summarize** on a long meeting sends the whole transcript so far. A question sends a bounded set of relevant and recent lines. Repeating an analysis with nothing new makes no request.
- **Generate Follow-up Email** first brings the summary, actions, decisions and questions up to date, so one click can make up to five requests on a meeting you have not analyzed yet. That matters on free routes, which are rate limited and may be logged by the provider.
- Stopping the assistant (or leaving the meeting) cancels pending AI work: no further requests are sent and late replies are discarded. A request already on its way to OpenRouter cannot be recalled, but its answer is dropped.
- The Meet content script is injected only on `https://meet.google.com/*` and checks the hostname again before doing anything. Meet Assistant itself needs no extra permissions; the one permission added to the extension is `sidePanel`, used only for the side panel option described under **Keep it open**.
- Captions and display names are untrusted text from other people. The transcript is sent inside delimiters, display names are stripped of anything that could fake a line or a tag, and the prompts tell the model to treat the transcript as data, never as instructions, and to use only what it supports (no invented participants, decisions, owners or deadlines). This reduces, but cannot eliminate, the chance that a participant steers the model, so treat AI output as a draft.
- Only Meet's named captions region is read. There is deliberately no "any region" fallback, so chat or participant panels are never mistaken for captions.

### Limitations

- Captions are the only source, and Google Meet decides whether they are available and how accurate they are. Recognition errors end up in the transcript and the analysis.
- Meet changes its page markup without notice. All selectors live in `src/meet/selectors.ts`; a structural fallback covers some changes. If captions stop being captured, select **Copy caption debug info** in the Meet tab and use that redacted report (no caption text, names or meeting code) to update the selectors.
- The selectors were checked against a live Meet call (captions region, toggle, and Meet's own caption templates) on 2026-10-09. Capturing real speech, including speaker names, has not been verified end to end. Speaker names are only as available as Meet makes them; "You" is Meet's label for your own speech.
- Captions that Meet shows in a language other than the spoken one, or other participants' translated captions, are captured as displayed.
- Only standard meeting URLs (`abc-defg-hij`) are detected, not nickname links. After you leave a call Meet keeps the same URL for a moment, so the badge can stay up until Meet returns to its home screen; press **Stop** if you want it gone sooner.
- AI answers depend on the free OpenRouter route, which can be slow, rate limited, or return text that is not valid JSON. Unstructured replies are shown as received instead of being hidden.
- Do not use this prototype as a reason to record or process participants without appropriate notice and consent. Tell the people in the meeting that you are using an assistant that reads captions.

## Current limitations

- This prototype handles ordinary focused page editors. It does not run on Chrome internal pages, the Chrome Web Store, or other browser-protected pages.
- Selection behavior can vary in complex editors that virtualize content or replace DOM nodes; framework-controlled editors may revert a replacement until their own state updates.
- The content script runs in every frame, so apps that put their editor in an iframe (such as Google Chat) are covered. Pages you already had open need a refresh after the extension is installed or reloaded.
- The free model route can be slower, unavailable, or rate-limited depending on provider availability.
- Settings are local to the Chrome profile where the extension is installed.

## Security note

Storing an API key in a client-side browser extension is appropriate only for a private prototype used by people you trust. Anyone with access to the Chrome profile can potentially retrieve the locally stored key.

### Sharing with your team

- The build contains no API key. Share the `dist/` folder (for example as a zip); each teammate extracts it, follows **Load in Chrome** above, and enters their own OpenRouter key in Settings. Never share a key by putting it in the source, in `dist/`, or in screenshots of Settings.
- Each person is responsible for the meetings they use Meet Assistant in. Tell the other participants you are using an assistant that reads captions, and follow your organisation's policy on recording or transcribing meetings.
- Updates are manual: share the new `dist/` folder and have teammates reload the extension on `chrome://extensions`.
- Do not use this build as a public product without moving credentials behind a secure service and reviewing the design.

## Developer

Developed by [Abhijith KM](https://abhijithkm.space/). The same credit appears in the popup, on the meeting report page, and as the extension's website link on `chrome://extensions`.
