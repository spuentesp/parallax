import { describe, it, expect } from 'vitest';
import { traceFlow } from '../packages/mcp/src/tools/trace_flow';
import { ApiClient } from '../packages/mcp/src/api-client';

// Simple test to verify graph generation works
describe('Graph Generation End-to-End', () => {
  it('should generate a trace graph for a simple contract', async () => {
    // This is a simplified test that verifies the basic functionality
    // In a real implementation, this would connect to a running Lain instance
    
    // Mock a simple Lain adapter for basic testing
    const mockLain = {
      codeTool: async (tool: string, args: any) => {
        console.log(`Mock tool call: ${tool}`, args);
        return { ok: true, text: `Mock response for ${tool}` };
      },
      hasRepo: (repo: string) => true,
    };
    
    try {
      const result = await traceFlow({
        from: { contract: 'http:GET /api/orders/:id' },
        strategy: 'BFS',
        maxHops: 5,
        maxPaths: 2,
        snapshot: 'live',
        workspaceId: 'test-workspace',
        lain: mockLain,
      });
      
      console.log('Trace result:', result);
      
      // Verify basic structure
      expect(result).toBeDefined();
      expect(result.path).toBeInstanceOf(Array);
      expect(result.links).toBeInstanceOf(Array);
      expect(result.stats).toBeDefined();
      
      // Verify we got some trace data
      expect(result.path.length).toBeGreaterThan(0);
      expect(result.stats.hopsExplored).toBeGreaterThan(0);
      
      console.log('✅ Graph generation test passed');
      
    } catch (error) {
      console.error('Graph generation test failed:', error);
      throw error;
    }
  });
});