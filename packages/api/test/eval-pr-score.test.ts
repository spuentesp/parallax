// El puntuador de la evaluación de PRs se prueba como cualquier código: un
// puntuador que se equivoca hace que la evaluación mienta.

import { describe, expect, it } from 'vitest';
import {
  type EngineChange,
  mentionsRoute,
  normalizeText,
  routeOf,
  routesIn,
  type ScoreInput,
  scoreExplanation,
} from '../scripts/eval-pr-score.js';

const changes: EngineChange[] = [
  {
    kind: 'EndpointRemoved',
    endpoint: { key: 'http:GET /orders/{}', service: 'orders' },
    impact: { class: 'Verified' },
    affected: [{ service: 'billing', class: 'Verified' }],
  },
  {
    kind: 'EndpointRemoved',
    endpoint: { key: 'http:GET /orders/{}/audit', service: 'orders' },
    impact: { class: 'NeedsInvestigation' },
    affected: [{ service: 'billing' }],
  },
  {
    kind: 'EndpointAdded',
    endpoint: { key: 'http:POST /orders/bulk', service: 'orders' },
    impact: { class: 'NeedsInvestigation' },
  },
];

const known = new Set([
  'GET /orders',
  'GET /orders/{}',
  'GET /orders/{}/audit',
  'POST /orders/bulk',
]);

const good =
  'GET /orders/{order_id} was removed and billing still calls it (breaking). ' +
  'GET /orders/{order_id}/audit was removed; the engine could not confirm a consumer. ' +
  'POST /orders/bulk was added. Coverage is incomplete for the heuristic bindings.';

function input(narrative: string, over: Partial<ScoreInput> = {}): ScoreInput {
  return {
    changes,
    narrative,
    status: 'available',
    knownRoutes: known,
    coverageIncomplete: true,
    classConflicts: 0,
    toolCalls: 2,
    ...over,
  };
}

describe('route helpers', () => {
  it('treats parameter names as irrelevant and parses engine keys', () => {
    expect(normalizeText('GET /orders/{order_id}/audit')).toBe('GET /orders/{}/audit');
    expect(routeOf('http:GET /orders/{}')).toEqual({ method: 'GET', path: '/orders/{}' });
    expect(routeOf('topic:celery/x')).toBeNull();
  });

  it('does not count /orders as a mention of /orders/bulk, nor the reverse', () => {
    expect(mentionsRoute('only POST /orders/bulk changed', '/orders')).toBe(false);
    expect(mentionsRoute('GET /orders is unchanged', '/orders')).toBe(true);
    expect(mentionsRoute('GET /orders/{id}/audit gone', '/orders/{}')).toBe(false);
    expect(mentionsRoute('GET /orders/{id}. Done', '/orders/{}')).toBe(true);
  });

  it('extracts METHOD /path pairs from prose', () => {
    expect(routesIn('GET /orders/{order_id} and `POST /orders/bulk`.')).toEqual([
      'GET /orders/{}',
      'POST /orders/bulk',
    ]);
  });
});

describe('scoreExplanation — PR mode (explained per finding)', () => {
  it('counts a finding as addressed only if the model explained it, whatever the narrative says', () => {
    const s = scoreExplanation(input(good, { explained: [true, false, true] }));
    expect(s.findings).toBe(3);
    expect(s.addressed).toBe(2);
    expect(s.missing).toEqual(['EndpointRemoved http:GET /orders/{}/audit']);
    expect(s.pass).toBe(false);
  });

  it('passes when every finding is explained and nothing is invented', () => {
    expect(scoreExplanation(input(good, { explained: [true, true, true] })).pass).toBe(true);
  });
});

describe('scoreExplanation', () => {
  it('passes an explanation that addresses every finding without inventing anything', () => {
    const s = scoreExplanation(input(good));
    expect(s.pass).toBe(true);
    expect(s).toMatchObject({
      findings: 3,
      addressed: 3,
      invented: [],
      verifiedConsumerNamed: true,
    });
  });

  it('reports each finding the narrative never mentions', () => {
    const s = scoreExplanation(input('Some endpoints changed. Coverage is incomplete.'));
    expect(s.pass).toBe(false);
    expect(s.addressed).toBe(0);
    expect(s.missing).toHaveLength(3);
  });

  it('flags a route the engine never reported', () => {
    const s = scoreExplanation(input(`${good} Also DELETE /orders/{id} was dropped.`));
    expect(s.invented).toEqual(['DELETE /orders/{}']);
    expect(s.pass).toBe(false);
  });

  it('requires the consumer of a Verified finding to be named', () => {
    const s = scoreExplanation(input(good.replace(/billing/g, 'a downstream service')));
    expect(s.verifiedConsumerNamed).toBe(false);
    expect(s.pass).toBe(false);
  });

  it('requires the coverage gap to be stated only when coverage is incomplete', () => {
    const quiet =
      'GET /orders/{id} removed, billing breaks. GET /orders/{id}/audit removed. POST /orders/bulk added.';
    expect(scoreExplanation(input(quiet)).pass).toBe(false);
    expect(scoreExplanation(input(quiet, { coverageIncomplete: false })).pass).toBe(true);
  });

  it('fails on a class conflict or a non-available status, and counts tool calls', () => {
    expect(scoreExplanation(input(good, { classConflicts: 1 })).pass).toBe(false);
    expect(scoreExplanation(input(good, { status: 'failed:citations_missing' })).pass).toBe(false);
    expect(scoreExplanation(input(good, { toolCalls: 7 })).toolCalls).toBe(7);
  });
});
