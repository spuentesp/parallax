import { describe, expect, it } from 'vitest';
import { createWindowLimiter } from '../src/rate-limit.js';

describe('createWindowLimiter', () => {
  it('allows up to the limit, then says how long until the oldest hit expires', () => {
    let t = 1000;
    const l = createWindowLimiter({ limit: 2, windowMs: 10_000, now: () => t });
    expect(l.take('a')).toEqual({ ok: true, remaining: 1 });
    t = 3000;
    expect(l.take('a')).toEqual({ ok: true, remaining: 0 });
    t = 4000;
    expect(l.take('a')).toEqual({ ok: false, retryAfterMs: 7000 });
  });

  it('frees a slot exactly when the oldest hit leaves the window', () => {
    let t = 0;
    const l = createWindowLimiter({ limit: 1, windowMs: 100, now: () => t });
    expect(l.take('a').ok).toBe(true);
    t = 99;
    expect(l.take('a').ok).toBe(false);
    t = 100;
    expect(l.take('a')).toEqual({ ok: true, remaining: 0 });
  });

  it('a refused attempt does not extend the penalty', () => {
    let t = 0;
    const l = createWindowLimiter({ limit: 1, windowMs: 100, now: () => t });
    l.take('a');
    t = 50;
    l.take('a');
    t = 100;
    expect(l.take('a').ok).toBe(true);
  });

  it('counts each key on its own', () => {
    const l = createWindowLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    expect(l.take('a').ok).toBe(true);
    expect(l.take('b').ok).toBe(true);
    expect(l.take('a').ok).toBe(false);
  });
});
