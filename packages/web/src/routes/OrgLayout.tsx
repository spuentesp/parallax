import type * as React from 'react';
import { useState } from 'react';
import { Link, Outlet, useNavigate, useOutlet, useParams, useSearchParams } from 'react-router-dom';
import { type ChatMessage, ChatPanel } from '../components/ChatPanel.js';
import { ContextPanel } from '../components/ContextPanel.js';
import { FlowActions } from '../components/FlowActions.js';
import { TopologyView, type TopologyViewData } from '../components/TopologyView.js';

export const SAMPLE_TOPOLOGY: TopologyViewData = {
  nodes: [
    { id: 'orders', label: 'orders', kind: 'service', parent: null },
    { id: 'billing', label: 'billing', kind: 'service', parent: null },
    { id: 'reports', label: 'reports', kind: 'service', parent: null },
    { id: 'platform', label: 'platform', kind: 'service', parent: null },
  ],
  edges: [
    { source: 'billing', target: 'orders', label: 'customer_id', kind: 'consumes' },
    { source: 'reports', target: 'orders', label: 'created_at', kind: 'consumes' },
    { source: 'platform', target: 'billing', label: 'invoice_id', kind: 'consumes' },
  ],
};

export function OrgLayout({
  emptyTopology = false,
}: {
  emptyTopology?: boolean;
}): React.ReactElement {
  const { orgId, serviceId } = useParams();
  const navigate = useNavigate();
  const outlet = useOutlet();
  const [searchParams] = useSearchParams();
  const nodeId = searchParams.get('node');
  const byParam = nodeId != null ? SAMPLE_TOPOLOGY.nodes.find((n) => n.id === nodeId) : undefined;
  // El panel abierto manda sobre ?node=: si divergen, el contexto es el del panel.
  const byPanel =
    serviceId != null ? SAMPLE_TOPOLOGY.nodes.find((n) => n.id === serviceId) : undefined;
  const selectedNode = byPanel ?? byParam;
  const unknownNode = nodeId != null && byParam === undefined;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const topology: TopologyViewData = emptyTopology ? { nodes: [], edges: [] } : SAMPLE_TOPOLOGY;

  const handleSend = (text: string) => {
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);
    // Subproject 5: call the QueryAgent API
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Analyzing "${text}"… Found ${topology.nodes.length} services. orders is the central service with billing and reports as consumers.`,
        },
      ]);
      setLoading(false);
    }, 1500);
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="text-xs font-medium mb-1" style={{ color: 'var(--color-muted, #a3a3a3)' }}>
          Organization
        </div>
        <h1 className="text-2xl font-bold">{orgId}</h1>
      </div>

      {unknownNode && (
        <p className="text-xs text-warning mb-2">
          Nodo no encontrado: «{nodeId}» no está en esta topología.
        </p>
      )}
      <FlowActions orgId={orgId ?? ''} selectedNode={selectedNode} />

      {topology.nodes.length === 0 ? (
        <div className="text-center py-12 rounded-xl border border-dashed border-border">
          <div className="text-3xl mb-2">⬡</div>
          <div className="text-sm text-muted mb-4">
            No topology yet. Configure a workspace to see its services here.
          </div>
          <Link to="/workspaces" className="text-accent">
            Configurar workspace →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
              <TopologyView
                data={topology}
                onSelect={(id) =>
                  navigate(
                    `/orgs/${orgId ?? ''}/services/${encodeURIComponent(id)}?node=${encodeURIComponent(id)}`,
                  )
                }
              />
            </div>
          </div>
          <div className="h-[600px]">
            <ChatPanel messages={messages} onSend={handleSend} loading={loading} />
          </div>
        </div>
      )}

      {outlet !== null && (
        <ContextPanel
          title={serviceId !== undefined ? `Service ${serviceId}` : 'Detalle'}
          onClose={() =>
            navigate(
              `/orgs/${orgId ?? ''}${nodeId != null ? `?node=${encodeURIComponent(nodeId)}` : ''}`,
            )
          }
        >
          <Outlet />
        </ContextPanel>
      )}
    </div>
  );
}
