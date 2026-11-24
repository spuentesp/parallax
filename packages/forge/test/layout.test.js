// Tests for the graph layout used by the Jira panel.
import { describe, expect, it } from 'vitest';
import {
  layoutGraph,
  NODE_H,
  NODE_W,
  PAD,
  shortLabel,
  strokeWidth,
  truncate,
} from '../panel/src/layout.js';

const target = (id) => ({ id, label: id, kind: 'target' });
const consumer = (id) => ({ id, label: id, kind: 'consumer' });
const edge = (from, to, usages = 3, provenance = 'deterministic') => ({
  from,
  to,
  usages,
  provenance,
});

describe('shortLabel', () => {
  it('reads an RPC as its method and an HTTP route as method and path', () => {
    expect(shortLabel('rpc:openshell.v1.OpenShell/CreateSandbox')).toBe('CreateSandbox');
    expect(shortLabel('http:POST /v1/chat/completions')).toBe('POST /v1/chat/completions');
  });
  it('leaves service names alone and survives empty input', () => {
    expect(shortLabel('openshell-gateway')).toBe('openshell-gateway');
    expect(shortLabel(undefined)).toBe('');
  });
});

describe('truncate', () => {
  it('shortens long text with an ellipsis and keeps short text', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(truncate('abc', 5)).toBe('abc');
    expect(truncate(undefined)).toBe('');
  });
});

describe('strokeWidth', () => {
  it('grows slowly with usage and never exceeds the cap', () => {
    expect(strokeWidth(1)).toBe(1);
    expect(strokeWidth(100)).toBeGreaterThan(strokeWidth(10));
    expect(strokeWidth(1_000_000)).toBe(5);
    expect(strokeWidth(undefined)).toBe(1);
  });
});

describe('layoutGraph', () => {
  it('puts consumers on the left and targets on the right', () => {
    const out = layoutGraph(
      { nodes: [consumer('web'), target('gw')], edges: [edge('web', 'gw')] },
      640,
    );
    const web = out.nodes.find((n) => n.id === 'web');
    const gw = out.nodes.find((n) => n.id === 'gw');
    expect(web.x).toBe(PAD);
    expect(gw.x).toBe(640 - PAD - NODE_W);
    expect(web.w).toBe(NODE_W);
    expect(web.h).toBe(NODE_H);
  });

  it('draws one curved edge per link, from the consumer edge to the target edge', () => {
    const out = layoutGraph({
      nodes: [consumer('a'), target('t')],
      edges: [edge('a', 't', 50, 'inferred')],
    });
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0].path).toMatch(/^M[\d.]+,[\d.]+ C/);
    expect(out.edges[0]).toMatchObject({ provenance: 'inferred', usages: 50 });
  });

  it('orders consumers to follow their targets so edges cross less', () => {
    // c2 points at the first target, c1 at the second: they must swap places.
    const out = layoutGraph({
      nodes: [target('t1'), target('t2'), consumer('c1'), consumer('c2')],
      edges: [edge('c1', 't2'), edge('c2', 't1')],
    });
    const y = (id) => out.nodes.find((n) => n.id === id).y;
    expect(y('c2')).toBeLessThan(y('c1'));
  });

  it('puts targets that something depends on first and flags the ones nothing depends on', () => {
    const out = layoutGraph({
      // the lonely target is listed first on purpose
      nodes: [target('lonely'), target('busy'), consumer('c')],
      edges: [edge('c', 'busy')],
    });
    const y = (id) => out.nodes.find((n) => n.id === id).y;
    expect(y('busy')).toBeLessThan(y('lonely'));
    expect(out.nodes.find((n) => n.id === 'lonely').isolated).toBe(true);
    expect(out.nodes.find((n) => n.id === 'busy').isolated).toBe(false);
  });

  it('grows taller with more rows and keeps lanes centred', () => {
    const small = layoutGraph({ nodes: [consumer('a'), target('t')], edges: [] });
    const tall = layoutGraph({
      nodes: [target('t'), ...['a', 'b', 'c', 'd', 'e'].map(consumer)],
      edges: [],
    });
    expect(tall.height).toBeGreaterThan(small.height);
    const t = tall.nodes.find((n) => n.id === 't');
    expect(t.y).toBeGreaterThan(PAD); // one target is centred against five consumers
  });

  it('ignores edges that point at unknown nodes instead of crashing', () => {
    const out = layoutGraph({ nodes: [consumer('a')], edges: [edge('a', 'ghost')] });
    expect(out.edges).toEqual([]);
  });

  it('handles an empty or missing graph', () => {
    expect(layoutGraph({ nodes: [], edges: [] })).toMatchObject({ nodes: [], edges: [] });
    expect(layoutGraph(undefined).nodes).toEqual([]);
  });
});
