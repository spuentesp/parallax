import type * as React from 'react';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { type MapFocusDto, useAsk, useWorkspace } from '../api/hooks.js';
import { type ChatMessage, ChatPanel } from '../components/ChatPanel.js';
import { FlowActions } from '../components/FlowActions.js';
import { MapExplorer } from '../map/MapExplorer.js';
import { nodeContext } from '../map/nodeId.js';

// Hub del command center: el mapa de la organización con el investigador al
// lado. El org se identifica con su workspace (es el mismo id que usa
// /api/query). Lo seleccionado vive en la URL (?sel=), así que las acciones de
// flujo (evaluar un PR) heredan el contexto y un enlace reproduce la vista.

export function OrgLayout(): React.ReactElement {
  const { orgId } = useParams();
  const [params, setParams] = useSearchParams();
  const ws = useWorkspace(orgId);
  const ask = useAsk(orgId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);

  const ctx = nodeContext(params.get('sel'));

  const handleSend = (text: string) => {
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    ask.mutate(text, {
      onSuccess: (res) =>
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: res.answer || 'No answer was produced.',
            claims: res.claims_summary,
            ...(res.claims ? { verdicts: res.claims } : {}),
            focus: res.map_focus,
            status: res.explanation_status,
          },
        ]),
      onError: (e) =>
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `The question could not be answered: ${e instanceof Error ? e.message : 'request failed'}`,
          },
        ]),
    });
  };

  // El agente deja el mapa apuntando a su subgrafo: foco + selección en la URL.
  const showOnMap = (focus: MapFocusDto) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('focus', focus.seed);
        next.set('hops', '1');
        next.set('sel', focus.seed);
        return next;
      },
      { replace: true },
    );

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-muted mb-1">Organization</div>
          <h1 className="text-2xl font-bold">{ws.data?.workspace?.name ?? orgId}</h1>
        </div>
        <button
          type="button"
          onClick={() => setChatOpen((o) => !o)}
          aria-expanded={chatOpen}
          className="px-3 py-1.5 rounded-lg text-sm bg-accent text-accent-fg"
        >
          {chatOpen ? 'Hide assistant' : 'Ask the architecture'}
        </button>
      </div>

      <FlowActions orgId={orgId ?? ''} selectedNode={ctx} />

      {orgId ? <MapExplorer workspaceId={orgId} /> : null}

      {chatOpen && (
        <div className="fixed bottom-6 right-6 z-30 w-[26rem] h-[34rem] max-h-[80vh]">
          <ChatPanel
            messages={messages}
            onSend={handleSend}
            loading={ask.isPending}
            onShowOnMap={showOnMap}
          />
        </div>
      )}
    </div>
  );
}
