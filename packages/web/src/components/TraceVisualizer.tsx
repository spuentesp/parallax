import React, { useState, useEffect } from 'react';
import { TraceFlowResult } from '../../types';

interface TraceVisualizerProps {
  traceFlowResults: TraceFlowResult[];
  onGapExplore: (gapId: string) => void;
  onStrategyChange: (strategy: 'BFS' | 'DFS') => void;
}

const TraceVisualizer: React.FC<TraceVisualizerProps> = ({
  traceFlowResults,
  onGapExplore,
  onStrategyChange
}) => {
  const [currentStrategy, setCurrentStrategy] = useState<'BFS' | 'DFS'>('BFS');
  const [selectedGap, setSelectedGap] = useState<string | null>(null);

  const handleStrategyChange = (strategy: 'BFS' | 'DFS') => {
    setCurrentStrategy(strategy);
    onStrategyChange(strategy);
  };

  const handleGapClick = (gapId: string) => {
    setSelectedGap(gapId);
    onGapExplore(gapId);
  };

  return (
    <div className="trace-visualizer">
      <div className="controls">
        <button
          onClick={() => handleStrategyChange('BFS')}
          className={currentStrategy === 'BFS' ? 'active' : ''}
        >
          BFS
        </button>
        <button
          onClick={() => handleStrategyChange('DFS')}
          className={currentStrategy === 'DFS' ? 'active' : ''}
        >
          DFS
        </button>
      </div>

      <div className="visualization">
        <div className="trace-flow">
        {traceFlowResults.map((result, index) => (
          <div key={index} className={`trace-segment ${result.isGap ? 'gap' : ''}`}>
            <div className="trace-info">
              <span className="trace-id">Trace ID: {result.traceId}</span>
              <span className="boundary-info">Boundary: {result.boundaryInfo}</span>
              {result.isGap && (
                <button
                  className="explore-gap"
                  onClick={() => handleGapClick(result.gapId)}
                >
                  Explore Gap
                </button>
              )}
            </div>
            <div className="trace-visualization">
              <svg width="100%" height="100">
                {result.tracePath.map((pathSegment, i) => (
                  <path
                    key={i}
                    d={pathSegment.path}
                    stroke={pathSegment.isCrossBoundary ? '#ff0000' : '#0000ff'}
                    strokeWidth="2"
                    fill="none"
                    markerEnd="url(#arrowhead)"
                  />
                ))}
                <defs>
                  <marker
                    id="arrowhead"
                    markerWidth="10"
                    markerHeight="7"
                    refX="9"
                    refY="3.5"
                    orient="auto"
                  >
                    <polygon points="0 0, 10 3.5, 0 7" fill="#000" />
                  </marker>
                </defs>
              </svg>
            </div>
          </div>
        ))}
      </div>
      </div>

      <div className="gap-explorer">
        {selectedGap && (
          <div className="gap-details">
            <h3>Gap Details</h3>
            <div className="gap-info">
              <p><strong>Gap ID:</strong> {selectedGap}</p>
              <p><strong>Description:</strong> Detailed information about the gap</p>
              <p><strong>Potential Candidates:</strong></p>
              <ul>
                {traceFlowResults
                  .find(result => result.gapId === selectedGap)
                  ?.candidates?.map((candidate, i) => (
                    <li key={i}>{candidate}</li>
                  )) || []}
              </ul>
            </div>
          </div>
        )}
        <div className="strategy-visualization">
          <h3>Strategy Visualization: {currentStrategy}</h3>
          <div className="strategy-steps">
            {traceFlowResults.map((result, index) => (
              <div key={index} className={`strategy-step ${currentStrategy === 'BFS' ? 'bfs' : 'dfs'}`}>
                <span className="step-number">{index + 1}</span>
                <span className="step-info">
                  {currentStrategy === 'BFS' ? 'Breadth-First Step' : 'Depth-First Step'}
                </span>
                <span className="trace-info">Trace: {result.traceId}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TraceVisualizer;
