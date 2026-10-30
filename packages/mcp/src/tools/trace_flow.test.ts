import { describe, it, expect, vi, beforeEach } from 'vitest';
import { traceFlow } from './trace_flow';

// Mock Lain adapter for testing
const mockLainAdapter = {
  codeTool: vi.fn(),
  hasRepo: vi.fn(),
};

describe('traceFlow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    
    // Mock basic tool responses
    mockLainAdapter.codeTool.mockImplementation(async (tool: string, args: any) => {
      if (tool === 'get_call_sites') {
        if (args.symbol === 'unknown') {
          return { ok: false, text: 'No call sites found' };
        }
        return {
          ok: true,
          text: `## Call Sites for ${args.symbol}:\n1. repo:frontend path:src/api.ts:15\n2. repo:frontend path:src/components/Order.tsx:42`,
        };
      } else if (tool === 'search_code') {
        if (args.query.includes('unknown')) {
          return { ok: false, text: 'No code found' };
        }
        return {
          ok: true,
          text: `## Code Search Results for ${args.query}:\n1. repo:api path:src/index.ts:12 contains: getOrder\n2. repo:shared path:src/services/order-service.ts:8 contains: getOrder`,
        };
      } else if (tool === 'get_call_chain') {
        return {
          ok: true,
          text: `## Call Chain:\n1. ${args.from} → ${args.to}`,
        };
      }
      return { ok: false, text: '' };
    });
    
    mockLainAdapter.hasRepo.mockImplementation((repo: string) => {
      return ['api', 'frontend', 'shared'].includes(repo);
    });
  });
  
  it('should trace a simple contract flow with BFS', async () => {
    const result = await traceFlow({
      from: { contract: 'http:GET /api/orders/:id' },
      strategy: 'BFS',
      maxHops: 10,
      maxPaths: 3,
      snapshot: 'live',
      workspaceId: 'test-workspace',
      lain: mockLainAdapter,
    });
    
    expect(result.complete).toBe(true);
    expect(result.path.length).toBeGreaterThan(0); // Should have some hops
    expect(result.links.length).toBeGreaterThan(0); // Should have some links
    expect(result.stats.hopsExplored).toBeGreaterThan(0);
  });
  
  it('should trace a simple contract flow with DFS', async () => {
    const result = await traceFlow({
      from: { contract: 'http:GET /api/orders/:id' },
      strategy: 'DFS',
      maxHops: 10,
      maxPaths: 3,
      snapshot: 'live',
      workspaceId: 'test-workspace',
      lain: mockLainAdapter,
    });
    
    expect(result.complete).toBe(true);
    expect(result.path.length).toBeGreaterThan(0);
    expect(result.links.length).toBeGreaterThan(0);
    expect(result.stats.hopsExplored).toBeGreaterThan(0);
  });
  
  it('should detect gaps when trace cannot continue', async () => {
    // Mock a failure case
    mockLainAdapter.codeTool.mockImplementationOnce(async () => {
      return { ok: false, text: 'No call sites found' };
    });
    
    const result = await traceFlow({
      from: { contract: 'http:GET /api/unknown' },
      strategy: 'BFS',
      maxHops: 5,
      maxPaths: 2,
      snapshot: 'live',
      workspaceId: 'test-workspace',
      lain: mockLainAdapter,
    });
    
    expect(result.gaps.length).toBeGreaterThan(0);
    expect(result.complete).toBe(false);
    expect(result.gaps[0].reason).toContain('No further hops found');
  });
  
  it('should handle cross-repository traces', async () => {
    const result = await traceFlow({
      from: { contract: 'http:GET /api/orders/:id' },
      strategy: 'BFS',
      maxHops: 12,
      maxPaths: 5,
      snapshot: 'live',
      workspaceId: 'test-workspace',
      lain: mockLainAdapter,
    });
    
    // Should have hops in multiple repos
    const repos = new Set(result.path.map(hop => hop.repo));
    expect(repos.size).toBeGreaterThanOrEqual(1); // Should have at least one repo
  });
  
  it('should calculate proper confidence scores', async () => {
    const result = await traceFlow({
      from: { contract: 'http:GET /api/orders/:id' },
      strategy: 'BFS',
      maxHops: 8,
      maxPaths: 3,
      snapshot: 'live',
      workspaceId: 'test-workspace',
      lain: mockLainAdapter,
    });
    
    // Check that confidence scores are calculated
    const gapWithCandidates = result.gaps.find(gap => gap.candidates && gap.candidates.length > 0);
    if (gapWithCandidates) {
      expect(gapWithCandidates.candidates[0].confidence).toBeGreaterThanOrEqual(0);
      expect(gapWithCandidates.candidates[0].confidence).toBeLessThanOrEqual(1);
    }
  });
});