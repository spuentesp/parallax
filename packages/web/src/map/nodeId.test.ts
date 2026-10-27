import { describe, expect, it } from 'vitest';
import { nodeContext } from './nodeId.js';

describe('nodeContext', () => {
  it('reads repo, service and endpoint ids', () => {
    expect(nodeContext('repo:orders')).toEqual({ kind: 'repo', name: 'orders' });
    expect(nodeContext('svc:billing')).toEqual({ kind: 'service', name: 'billing' });
    // El servicio es lo que va tras la ÚLTIMA @: la clave del contrato puede llevar otras.
    expect(nodeContext('ep:http:GET /u/{id}@me@orders')).toEqual({
      kind: 'endpoint',
      name: 'orders',
    });
  });
  it('returns null for anything else', () => {
    expect(nodeContext(null)).toBeNull();
    expect(nodeContext('')).toBeNull();
    expect(nodeContext('whatever')).toBeNull();
    expect(nodeContext('ep:no-owner')).toBeNull();
  });
});
