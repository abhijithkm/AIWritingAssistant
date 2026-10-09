import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectMeetPage, findCaptionContainer, getMeetingCode, isMeetHost, watchNavigation } from '../src/meet/meet-detector';

describe('isMeetHost / getMeetingCode', () => {
  it('only accepts meet.google.com', () => {
    expect(isMeetHost('meet.google.com')).toBe(true);
    expect(isMeetHost('docs.google.com')).toBe(false);
    expect(isMeetHost('meet.google.com.evil.example')).toBe(false);
  });

  it('extracts the meeting code from the path and rejects non-meeting pages', () => {
    expect(getMeetingCode('/abc-defg-hij')).toBe('abc-defg-hij');
    expect(getMeetingCode('/abc-defg-hij/')).toBe('abc-defg-hij');
    expect(getMeetingCode('/')).toBeNull();
    expect(getMeetingCode('/landing')).toBeNull();
    expect(getMeetingCode('/new')).toBeNull();
    expect(getMeetingCode('/lookup/abc')).toBeNull();
  });
});

describe('findCaptionContainer / detectMeetPage', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('finds the labelled captions region', () => {
    document.body.innerHTML = '<div role="region" aria-label="Captions"><div>hi</div></div>';
    expect(findCaptionContainer(document)?.element.getAttribute('aria-label')).toBe('Captions');
  });

  it('prefers the labelled region over an outer wrapper that also matches', () => {
    document.body.innerHTML = '<div jsname="dsyhDe" id="wrapper"><div role="region" aria-label="Captions" id="region"></div></div>';
    expect(findCaptionContainer(document)?.element.id).toBe('region');
  });

  it('does not treat a generic region as captions, so other panels are never read', () => {
    document.body.innerHTML = '<div role="region" tabindex="0"><div>Chat: some private message</div></div>';
    expect(findCaptionContainer(document)).toBeNull();
    expect(detectMeetPage(document, '/abc-defg-hij').captions).toBe('unknown');
  });

  it('reports captions on when the container exists', () => {
    document.body.innerHTML = '<div role="region" aria-label="Captions"></div>';
    expect(detectMeetPage(document, '/abc-defg-hij')).toEqual({ meetingDetected: true, meetingCode: 'abc-defg-hij', captions: 'on' });
  });

  it('reads the captions toggle when nobody has spoken yet', () => {
    document.body.innerHTML = '<button aria-label="Turn on captions (c)"></button>';
    expect(detectMeetPage(document, '/abc-defg-hij').captions).toBe('off');
    document.body.innerHTML = '<button aria-label="Turn off captions (c)"></button>';
    expect(detectMeetPage(document, '/abc-defg-hij').captions).toBe('on');
    document.body.innerHTML = '<button aria-label="Captions" aria-pressed="true"></button>';
    expect(detectMeetPage(document, '/abc-defg-hij').captions).toBe('on');
    document.body.innerHTML = '<button aria-label="Captions" aria-pressed="false"></button>';
    expect(detectMeetPage(document, '/abc-defg-hij').captions).toBe('off');
  });

  it('is unknown when there is no container and no toggle, and not a meeting off a meeting path', () => {
    expect(detectMeetPage(document, '/abc-defg-hij').captions).toBe('unknown');
    expect(detectMeetPage(document, '/landing')).toEqual({ meetingDetected: false, meetingCode: null, captions: 'unknown' });
  });
});

describe('watchNavigation', () => {
  beforeEach(() => { vi.useFakeTimers(); history.replaceState(null, '', '/landing'); });
  afterEach(() => { vi.useRealTimers(); });

  it('reports pushState navigations that never fire an event', () => {
    const seen: string[] = [];
    const stop = watchNavigation((url) => seen.push(new URL(url).pathname));
    history.pushState(null, '', '/abc-defg-hij');
    vi.advanceTimersByTime(1_100);
    expect(seen).toEqual(['/abc-defg-hij']);
    vi.advanceTimersByTime(3_000);
    expect(seen).toEqual(['/abc-defg-hij']);
    stop();
    history.pushState(null, '', '/xyz-wxyz-abc');
    vi.advanceTimersByTime(2_000);
    expect(seen).toEqual(['/abc-defg-hij']);
  });

  it('reports popstate immediately', () => {
    const seen: string[] = [];
    const stop = watchNavigation((url) => seen.push(new URL(url).pathname));
    history.replaceState(null, '', '/abc-defg-hij');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(seen).toEqual(['/abc-defg-hij']);
    stop();
  });
});
