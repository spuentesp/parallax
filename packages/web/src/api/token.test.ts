import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearToken, currentToken, readToken, saveToken } from './token.js';

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
