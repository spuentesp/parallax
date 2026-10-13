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
    // In subproject 5, this calls the QueryAgent via the API.
    // For now, return a static response with the sample topology.
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Analizando "${text}"… Encontré 4 servicios en la organización. La topología muestra orders como servicio central, con billing y reports como consumidores. La visualización adjunta muestra las relaciones de datos (customer_id, created_at, invoice_id).`,
          topology: SAMPLE_TOPOLOGY,
        },
      ]);
      setTopology(SAMPLE_TOPOLOGY);
      setLoading(false);
    }, 1000);
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
