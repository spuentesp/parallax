import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureTokenFromUrl, clearToken, currentToken, readToken, saveToken } from './token.js';

afterEach(() => {
  clearToken();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('token store', () => {
  it('saves a trimmed token, reads it back and clears it', () => {
    expect(readToken()).toBeUndefined();
    saveToken('  abc  ');
    expect(readToken()).toBe('abc');
    expect(currentToken()).toBe('abc');
    clearToken();
    expect(readToken()).toBeUndefined();
    expect(currentToken()).toBeUndefined();
  });

  it('keeps the session in memory when storage is blocked, and forgets it on sign-out', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    saveToken('mem');
    expect(readToken()).toBeUndefined();
    expect(currentToken()).toBe('mem');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    clearToken();
    expect(currentToken()).toBeUndefined();
  });
});

describe('captureTokenFromUrl', () => {
  it('stores the link token and removes only it from the address bar', () => {
    window.history.replaceState(null, '', '/orgs/acme?token=sekret&focus=svc%3Aa#top');
    expect(captureTokenFromUrl()).toBe(true);
    expect(readToken()).toBe('sekret');
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/orgs/acme?focus=svc%3Aa#top',
    );
    // Una segunda vez no hay nada que capturar.
    expect(captureTokenFromUrl()).toBe(false);
    expect(readToken()).toBe('sekret');
  });

  it('does nothing without a token, and ignores an empty one', () => {
    window.history.replaceState(null, '', '/x?a=1');
    expect(captureTokenFromUrl()).toBe(false);
    window.history.replaceState(null, '', '/x?token=');
    expect(captureTokenFromUrl()).toBe(false);
    expect(readToken()).toBeUndefined();
  });
});
