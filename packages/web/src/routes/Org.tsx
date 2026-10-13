import type * as React from 'react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { type ChatMessage, ChatPanel } from '../components/ChatPanel.js';
import { TopologyView, type TopologyViewData } from '../components/TopologyView.js';

const SAMPLE_TOPOLOGY: TopologyViewData = {
  nodes: [
    { id: 'orders', label: 'orders', kind: 'service' },
    { id: 'billing', label: 'billing', kind: 'service' },
    { id: 'reports', label: 'reports', kind: 'service' },
    { id: 'platform', label: 'platform', kind: 'service' },
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
  const [topology, setTopology] = useState<TopologyViewData>(SAMPLE_TOPOLOGY);

  const handleSend = (text: string) => {
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);
    // Call the QueryAgent API
    fetch('/api/query', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${localStorage.getItem('parallax_token') ?? ''}`,
      },
      body: JSON.stringify({ question: text, orgId: orgId ?? 'default' }),
    })
      .then((r) => r.json())
      .then((data: { answer: string; topology?: unknown }) => {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.answer,
            topology: data.topology as { nodes: unknown[]; edges: unknown[] },
          },
        ]);
        if (data.topology) setTopology(data.topology as TopologyViewData);
      })
      .catch(() => {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'Error al consultar el agente. Intenta de nuevo.' },
        ]);
      })
      .finally(() => setLoading(false));
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
      <h1 style={{ margin: '0 0 12px' }}>Organization {orgId}</h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16, flex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TopologyView data={topology} />
          <nav style={{ display: 'flex', gap: 12 }}>
            <a href={`/orgs/${orgId}/assessments`}>Assessments</a>
          </nav>
        </div>
        <ChatPanel messages={messages} onSend={handleSend} loading={loading} />
      </div>
    </section>
  );
}
