// The bundler can wrap a CommonJS default export in more than one way; all of them must work.
import { describe, expect, it } from 'vitest';
import { pickClass } from '../src/interop.js';

class Thing {}

describe('pickClass', () => {
  it('accepts the class itself', () => {
    expect(pickClass(Thing)).toBe(Thing);
  });
  it('unwraps { default: Class }', () => {
    expect(pickClass({ default: Thing })).toBe(Thing);
  });
  it('unwraps { default: { default: Class } } (a CommonJS module seen as a namespace)', () => {
    expect(pickClass({ default: { default: Thing, makeResolver: () => 1 } })).toBe(Thing);
  });
  it('is the real @forge/resolver shape: the class is found and can be constructed', async () => {
    const mod = await import('@forge/resolver');
    const Resolver = pickClass(mod);
    const r = new Resolver();
    r.define('x', () => 1);
    expect(typeof r.getDefinitions()).toBe('function');
  });
  it('fails loudly when there is no class to find', () => {
    expect(() => pickClass({ default: { nope: 1 } })).toThrow(/Could not find the exported class/);
    expect(() => pickClass(undefined)).toThrow();
  });
});
