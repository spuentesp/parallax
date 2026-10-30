#!/usr/bin/env tsx

import { traceFlow } from '../packages/mcp/src/tools/trace_flow';

// Mock Lain adapter that simulates a complete cross-boundary trace
const mockLain = {
  codeTool: async (tool: string, args: any) => {
    console.log(`[Mock] ${tool} called with:`, args);
    
    if (tool === 'get_call_sites') {
      if (args.symbol === 'getOrder') {
        return {
          ok: true,
          text: `## Call Sites for getOrder:\n1. repo:frontend path:src/api.ts:15\n2. repo:frontend path:src/components/Order.tsx:42`,
        };
      } else if (args.symbol === 'OrderService') {
        return {
          ok: true,
          text: `## Call Sites for OrderService:\n1. repo:api path:src/index.ts:8`,
        };
      }
    } else if (tool === 'search_code') {
      if (args.query === 'getOrder') {
        return {
          ok: true,
          text: `## Code Search Results for getOrder:\n1. repo:api path:src/index.ts:12 contains: getOrder\n2. repo:shared path:src/services/order-service.ts:8 contains: getOrder`,
        };
      } else if (args.query === 'Database') {
        return {
          ok: true,
          text: `## Code Search Results for Database:\n1. repo:shared path:src/database.ts:1 contains: Database`,
        };
      }
    } else if (tool === 'get_call_chain') {
      return {
        ok: true,
        text: `## Call Chain:\n1. ${args.from} → ${args.to}`,
      };
    }
    
    return { ok: false, text: 'Not found' };
  },
  hasRepo: (repo: string) => ['api', 'frontend', 'shared'].includes(repo),
};

async function demonstrateCrossBoundaryTracing() {
  console.log('🚀 Demonstrating Cross-Boundary Tracing');
  console.log('='.repeat(50));
  
  const result = await traceFlow({
    from: { contract: 'http:GET /api/orders/:id' },
    strategy: 'BFS',
    maxHops: 10,
    maxPaths: 3,
    snapshot: 'live',
    workspaceId: 'demo-workspace',
    lain: mockLain,
  });
  
  console.log('\n📊 Trace Results:');
  console.log('='.repeat(50));
  console.log(`✅ Complete: ${result.complete}`);
  console.log(`🔍 Hops Explored: ${result.stats.hopsExplored}`);
  console.log(`📈 Hops Confirmed: ${result.stats.hopsConfirmed}`);
  console.log(`🔗 Links Created: ${result.stats.linksConfirmed}`);
  console.log(`❌ Gaps Detected: ${result.stats.gapsDetected}`);
  console.log(`⏱️  Duration: ${result.stats.durationMs}ms`);
  
  console.log('\n🛤️  Trace Path:');
  console.log('-'.repeat(30));
  result.path.forEach((hop, index) => {
    console.log(`${index + 1}. [${hop.lane}] ${hop.label}`);
    console.log(`   📍 ${hop.repo}:${hop.path}:${hop.line}`);
    console.log(`   🆔 ${hop.contains} (${hop.status})`);
    if (hop.reason) console.log(`   💡 ${hop.reason}`);
    console.log();
  });
  
  console.log('\n🔗 Links:');
  console.log('-'.repeat(30));
  result.links.forEach((link, index) => {
    console.log(`${index + 1}. ${link.from} → ${link.to}`);
    console.log(`   🔄 ${link.relation} (${link.basis})`);
    console.log(`   💬 ${link.because}`);
    console.log();
  });
  
  if (result.gaps.length > 0) {
    console.log('\n⚠️  Gaps:');
    console.log('-'.repeat(30));
    result.gaps.forEach((gap, index) => {
      console.log(`${index + 1}. After ${gap.after}: ${gap.reason}`);
      if (gap.candidates && gap.candidates.length > 0) {
        console.log('   🔎 Candidates:');
        gap.candidates.forEach((candidate, cIndex) => {
          console.log(`   ${cIndex + 1}. ${candidate.repo}:${candidate.path}:${candidate.line} (${candidate.contains})`);
          console.log(`      Confidence: ${candidate.confidence}`);
        });
      }
      console.log();
    });
  }
  
  if (result.sink) {
    console.log('\n🎯 Sink:');
    console.log('-'.repeat(30));
    console.log(`📍 ${result.sink.hop}`);
    console.log(`🏷️  ${result.sink.kind}`);
    console.log(`💬 ${result.sink.description}`);
  }
  
  console.log('\n🎉 Cross-Boundary Tracing Demonstration Complete!');
}

demonstrateCrossBoundaryTracing().catch(console.error);