import { describe, expect, it } from 'vitest';
import { nodeContext } from './nodeId.js';

describe('nodeContext', () => {
  it('reads repo, service and endpoint ids', () => {
    expect(nodeContext('repo:orders')).toEqual({ kind: 'repo', name: 'orders' });
    expect(nodeContext('interfaces:orders')).toEqual({ kind: 'repo', name: 'orders' });
    expect(nodeContext('svc:billing')).toEqual({ kind: 'service', name: 'billing' });
    // El servicio es lo que va tras la ÚLTIMA @: la clave del contrato puede llevar otras.
    expect(nodeContext('ep:http:GET /u/{id}@me@orders')).toEqual({
      kind: 'endpoint',
      name: 'orders',
    });
  });
  it('reads code nodes as their repo, so flow actions keep the repo context', () => {
    expect(nodeContext('code:orders')).toEqual({ kind: 'repo', name: 'orders' });
    expect(nodeContext('sym:orders|Function|a|b')).toEqual({ kind: 'repo', name: 'orders' });
    expect(nodeContext('sym:broken')).toBeNull();
  });
  it('returns null for anything else', () => {
    expect(nodeContext(null)).toBeNull();
    expect(nodeContext('')).toBeNull();
    expect(nodeContext('whatever')).toBeNull();
    expect(nodeContext('ep:no-owner')).toBeNull();
  });
});

describe('nodeContext — boundaries', () => {
  it('needs at least one character in each part of a code id', () => {
    expect(nodeContext('sym:|Function|x')).toBeNull();
    expect(nodeContext('sym:a|Function|x')).toEqual({ kind: 'repo', name: 'a' });
    expect(nodeContext('code:')).toEqual({ kind: 'repo', name: '' });
  });
  it('an endpoint id needs a key before the owner', () => {
    expect(nodeContext('ep:@orders')).toBeNull();
    expect(nodeContext('ep:k@orders')).toEqual({ kind: 'endpoint', name: 'orders' });
  });
  it('a repo name containing "sym:" or "svc:" is still read by its own prefix', () => {
    expect(nodeContext('repo:svc:x')).toEqual({ kind: 'repo', name: 'svc:x' });
  });
});
