#!/usr/bin/env node

import fs from 'fs';

// Load the demo graph data
const graphData = JSON.parse(fs.readFileSync('./test/graph-demo.json', 'utf-8'));

function visualizeGraph() {
  console.log('🚀 Parallax Cross-Boundary Trace Visualization');
  console.log('='.repeat(60));
  console.log(`📋 Contract: ${graphData.input.from.contract}`);
  console.log(`🔍 Strategy: ${graphData.input.strategy}`);
  console.log(`✅ Complete: ${graphData.complete}`);
  console.log();
  
  console.log('🛤️  Trace Path (UI → API → DB → RPC → UI):');
  console.log('-'.repeat(60));
  
  // Group by lane for better visualization
  const lanes = ['data', 'data_access', 'domain', 'api_handler', 'contract', 'client_call', 'client_logic'];
  
  lanes.forEach(lane => {
    const laneHops = graphData.path.filter(hop => hop.lane === lane);
    if (laneHops.length > 0) {
      console.log(`📍 ${lane.toUpperCase()}:`);
      laneHops.forEach(hop => {
        console.log(`   • ${hop.label}`);
        console.log(`     📁 ${hop.repo}:${hop.path}:${hop.line}`);
        console.log(`     🆔 ${hop.contains}`);
      });
      console.log();
    }
  });
  
  console.log('🔗 Cross-Boundary Links:');
  console.log('-'.repeat(60));
  graphData.links.forEach((link: any) => {
    const fromHop = graphData.path.find((h: any) => h.id === link.from);
    const toHop = graphData.path.find((h: any) => h.id === link.to);
    
    if (fromHop && toHop) {
      console.log(`🔄 ${fromHop.lane} → ${toHop.lane}`);
      console.log(`   ${fromHop.label} → ${toHop.label}`);
      console.log(`   📍 ${fromHop.repo} → ${toHop.repo}`);
      console.log(`   💡 ${link.relation} (${link.basis})`);
      console.log();
    }
  });
  
  if (graphData.sink) {
    console.log('🎯 Final Destination:');
    console.log('-'.repeat(60));
    const sinkHop = graphData.path.find((h: any) => h.id === graphData.sink.hop);
    if (sinkHop) {
      console.log(`📍 ${sinkHop.lane}: ${sinkHop.label}`);
      console.log(`📁 ${sinkHop.repo}:${sinkHop.path}:${sinkHop.line}`);
      console.log(`🏷️  ${graphData.sink.kind}`);
      console.log(`💬 ${graphData.sink.description}`);
    }
  }
  
  console.log('📊 Statistics:');
  console.log('-'.repeat(60));
  console.log(`🔍 Hops Explored: ${graphData.stats.hopsExplored}`);
  console.log(`✅ Hops Confirmed: ${graphData.stats.hopsConfirmed}`);
  console.log(`🔗 Links Created: ${graphData.stats.linksConfirmed}`);
  console.log(`❌ Gaps Detected: ${graphData.stats.gapsDetected}`);
  console.log(`⏱️  Duration: ${graphData.stats.durationMs}ms`);
  
  console.log();
  console.log('🎉 Cross-Boundary Trace Visualization Complete!');
  console.log();
  console.log('This demonstrates how Parallax can now trace:');
  console.log('• UI components → API endpoints → Domain logic → Database');
  console.log('• Cross-repository dependencies');
  console.log('• RPC service boundaries');
  console.log('• Complete end-to-end flows');
}

visualizeGraph();