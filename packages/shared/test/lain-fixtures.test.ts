import { describe, expect, it } from 'vitest';
import {
  analyzerVersion,
  apiVersion,
  services,
  scenarios,
  s1RemoveCustomerId,
  s2AddCurrency,
} from './lain-fixtures.js';
import { ListServicesResponse, DiffContractsResponse } from '../src/lain/tools.js';

describe('lain fixtures', () => {
  it('declares apiVersion=1 and a non-empty analyzerVersion', () => {
    expect(apiVersion).toBe('1');
    expect(analyzerVersion).toMatch(/[0-9]+\.[0-9]+\.[0-9]+/);
  });
  it('lists the four services from the design fixture', () => {
    expect(services).toHaveLength(4);
    const ids = services.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['orders', 'billing', 'reports', 'platform']));
  });
  it('s1-remove-customer-id fixture is a FieldRemoved with billing as consumer', () => {
    const parsed = DiffContractsResponse.parse(s1RemoveCustomerId.diffContracts);
    expect(parsed.changes[0]?.kind).toBe('FieldRemoved');
    expect(parsed.changes[0]?.field).toBe('customer_id');
  });
  it('s2-add-currency fixture is a compatible change with no FieldRemoved', () => {
    const parsed = DiffContractsResponse.parse(s2AddCurrency.diffContracts);
    const removed = parsed.changes.filter((c) => c.kind === 'FieldRemoved');
    expect(removed).toHaveLength(0);
  });
  it('scenarios registry is keyed by id', () => {
    expect(scenarios['s1-remove-customer-id']).toBe(s1RemoveCustomerId);
    expect(scenarios['s2-add-currency']).toBe(s2AddCurrency);
  });
  it('every service passes ListServicesResponse', () => {
    expect(() => ListServicesResponse.parse({ view: 'live', services })).not.toThrow();
  });
});
