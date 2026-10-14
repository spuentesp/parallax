import type * as React from 'react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { type ChatMessage, ChatPanel } from '../components/ChatPanel.js';
import { TopologyView, type TopologyViewData } from '../components/TopologyView.js';

const SAMPLE_TOPOLOGY: TopologyViewData = {
  nodes: [
    { id: 'orders', label: 'orders', kind: 'service' , parent: null },
    { id: 'billing', label: 'billing', kind: 'service' , parent: null },
    { id: 'reports', label: 'reports', kind: 'service' , parent: null },
    { id: 'platform', label: 'platform', kind: 'service' , parent: null },
  ],
  edges: [
    { source: 'billing', target: 'orders', label: 'customer_id', kind: 'consumes' },
    { source: 'reports', target: 'orders', label: 'created_at', kind: 'consumes' },
    { source: 'platform', target: 'billing', label: 'invoice_id', kind: 'consumes' },
  ],
};

export function Org(): React.ReactElement {
  const { orgId } = useParams();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [topology] = useState<TopologyViewData>(SAMPLE_TOPOLOGY);

  const handleSend = (text: string) => {
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);
    // Subproject 5: call the QueryAgent API
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Analyzing "${text}"… Found 4 services. orders is the central service with billing and reports as consumers. The topology shows data relationships (customer_id, created_at, invoice_id).`,
        },
      ]);
      setLoading(false);
    }, 1500);
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="text-xs font-medium mb-1" style={{ color: 'var(--color-muted, #a3a3a3)' }}>
          Organization
        </div>
        <h1 className="text-2xl font-bold">{orgId}</h1>
      </div>

      {/* Main grid: topology + chat */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Topology */}
        <div className="lg:col-span-2">
          <div
            className="rounded-xl p-4"
            style={{
              background: 'var(--color-surface, #171717)',
              border: '1px solid var(--color-border, #262626)',
              overflow: 'hidden',
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold">Service Topology</div>
              <div
                className="text-xs px-2 py-1 rounded"
                style={{
                  background: 'var(--color-bg, #0a0a0a)',
                  color: 'var(--color-muted, #a3a3a3)',
                }}
              >
                {topology.nodes.length} services · {topology.edges.length} relations
              </div>
            </div>
            <TopologyView data={topology} />
          </div>
        </div>

        {/* Chat */}
        <div className="h-[600px]">
          <ChatPanel messages={messages} onSend={handleSend} loading={loading} />
        </div>
      </div>
    </div>
  );
}
