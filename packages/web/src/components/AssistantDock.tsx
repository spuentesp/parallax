import { useQueryClient } from '@tanstack/react-query';
import type * as React from 'react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  type MapFocusDto,
  type TurnDto,
  useAsk,
  useConversation,
  useConversations,
  useDeleteConversation,
} from '../api/hooks.js';
import { type ChatMessage, ChatPanel, summarizeVerdicts } from './ChatPanel.js';

// El asistente ("Ask the architecture") es UNO para toda la app: se monta en el
// hub del org y en el detalle del workspace, así el mapa nunca aparece sin él.
// La conversación vive en el servidor y en la URL (?conv=): recargar o abrir el
// enlace recupera el hilo.

export function AssistantDock({ workspaceId }: { workspaceId: string }): React.ReactElement {
  const orgId = workspaceId;
  const [params, setParams] = useSearchParams();
  const ask = useAsk(orgId);
  const qc = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);

  // La conversación vive en el servidor y en la URL (?conv=): recargar la página
  // o abrir el enlace recupera el hilo.
  const convId = params.get('conv');
  const conv = useConversation(convId);
  const convs = useConversations(orgId);
  const del = useDeleteConversation();
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const setConv = (id: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set('conv', id);
        else next.delete('conv');
        return next;
      },
      { replace: true },
    );

  // Al abrir una conversación guardada se muestran sus turnos (una sola vez por id:
  // lo que se pregunta después se añade en local y el servidor ya lo tiene).
  useEffect(() => {
    if (!convId || !conv.data || loadedFor === convId) return;
    setMessages(turnsToMessages(conv.data.turns));
    setLoadedFor(convId);
    setChatOpen(true);
  }, [convId, conv.data, loadedFor]);

  // Una conversación que acabamos de crear existe aunque la lectura aún no la vea.
  const missing = convId !== null && conv.isError && loadedFor !== convId;

  const handleSend = (text: string) => {
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    ask.mutate(
      { question: text, conversationId: missing ? undefined : (convId ?? undefined) },
      {
        onSuccess: (res) => {
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
          ]);
          if (res.conversation) {
            setLoadedFor(res.conversation.id);
            setConv(res.conversation.id);
            void qc.invalidateQueries({ queryKey: ['conversations'] });
          }
        },
        onError: (e) =>
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: `The question could not be answered: ${e instanceof Error ? e.message : 'request failed'}`,
            },
          ]),
      },
    );
  };

  const startNew = () => {
    setMessages([]);
    setLoadedFor(null);
    setConv(null);
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
    <>
      <button
        type="button"
        onClick={() => setChatOpen((o) => !o)}
        aria-expanded={chatOpen}
        className="fixed bottom-6 right-6 z-40 px-4 py-2 rounded-full text-sm shadow-lg bg-accent text-accent-fg"
      >
        {chatOpen ? 'Hide assistant' : 'Ask the architecture'}
      </button>
      {chatOpen && (
        <div className="fixed bottom-20 right-6 z-30 w-[26rem] h-[36rem] max-h-[75vh]">
          <ChatPanel
            messages={messages}
            onSend={handleSend}
            loading={ask.isPending}
            onShowOnMap={showOnMap}
            conversations={convs.data?.conversations ?? []}
            activeId={missing ? null : convId}
            onNew={startNew}
            onOpen={(id) => {
              setMessages([]);
              setLoadedFor(null);
              setConv(id);
            }}
            onDelete={(id) =>
              del.mutate(id, {
                onSuccess: () => {
                  if (id === convId) startNew();
                },
              })
            }
            notice={
              missing
                ? 'That conversation is not available (it was deleted, or it belongs to another access token). Your next question starts a new one.'
                : null
            }
          />
        </div>
      )}
    </>
  );
}

/** Los turnos guardados, como los mensajes del chat (con el veredicto del motor de cada uno). */
export function turnsToMessages(turns: readonly TurnDto[]): ChatMessage[] {
  return turns.flatMap((t): ChatMessage[] => [
    { role: 'user', content: t.question },
    {
      role: 'assistant',
      content: t.answer || 'No answer was produced.',
      claims: summarizeVerdicts(t.claims),
      verdicts: t.claims,
      focus: t.focus,
      status: t.status,
    },
  ]);
}
