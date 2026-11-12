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
import { readConv, writeConv } from '../nav/mapState.js';
import { DocsCard, DoorsCard, OrientCard } from '../onboarding/Cards.js';
import {
  CHAPTERS,
  DEFAULT_TASK,
  explainDocPrompt,
  type TourContext,
} from '../onboarding/chapters.js';
import { TourBar, TourSetup } from '../onboarding/TourBar.js';
import { useOnboarding } from '../onboarding/useOnboarding.js';
import { type ChatMessage, ChatPanel, summarizeVerdicts } from './ChatPanel.js';
import { useMediaQuery } from './useMediaQuery.js';

// El asistente ("Ask the architecture") es UNO para toda la app: se monta en el
// hub del org y en el detalle del workspace, así el mapa nunca aparece sin él.
// La conversación vive en el servidor y en la URL (?conv=): recargar o abrir el
// enlace recupera el hilo.

export function AssistantDock({
  workspaceId,
  docked = false,
}: {
  workspaceId: string;
  /** En pantallas anchas va pegado a la derecha; en las demás, se abre como overlay. */
  docked?: boolean;
}): React.ReactElement {
  const orgId = workspaceId;
  const [params, setParams] = useSearchParams();
  const ask = useAsk(orgId);
  const qc = useQueryClient();
  const wideDock = useMediaQuery('(min-width: 1280px)');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Abierto/cerrado por separado: ocultarlo en el mapa no lo abre sobre otra sección.
  const [openDocked, setOpenDocked] = useState(wideDock);
  const [openFloating, setOpenFloating] = useState(false);
  const chatOpen = docked ? openDocked : openFloating;
  const setChatOpen = docked ? setOpenDocked : setOpenFloating;
  useEffect(() => {
    if (docked) setOpenDocked(wideDock);
  }, [docked, wideDock]);

  // La conversación vive en el servidor y en la URL (?conv=): recargar la página
  // o abrir el enlace recupera el hilo.
  // El hilo abierto: la URL (?conv=) manda; si no, el último de este workspace.
  // Se recuerda aparte porque otras secciones no llevan ?conv= en su URL.
  const urlConv = params.get('conv');
  const [convId, setConvId] = useState<string | null>(urlConv ?? readConv(orgId));
  useEffect(() => {
    if (urlConv && urlConv !== convId) setConvId(urlConv);
  }, [urlConv, convId]);
  const conv = useConversation(convId);
  const convs = useConversations(orgId);
  const del = useDeleteConversation();
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const setConv = (id: string | null) => {
    setConvId(id);
    writeConv(orgId, id);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set('conv', id);
        else next.delete('conv');
        return next;
      },
      { replace: true },
    );
  };

  // Al abrir una conversación guardada se muestran sus turnos (una sola vez por id:
  // lo que se pregunta después se añade en local y el servidor ya lo tiene).
  useEffect(() => {
    if (!convId || !conv.data || loadedFor === convId) return;
    setMessages(turnsToMessages(conv.data.turns));
    setLoadedFor(convId);
    setOpenDocked(true);
    setOpenFloating(true);
  }, [convId, conv.data, loadedFor]);

  // Una conversación que acabamos de crear existe aunque la lectura aún no la vea.
  const missing = convId !== null && conv.isError && loadedFor !== convId;

  const handleSend = (text: string, label?: string) => {
    setMessages((prev) => [...prev, { role: 'user', content: text, ...(label ? { label } : {}) }]);
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
              ...(res.roadmap ? { roadmap: res.roadmap } : {}),
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

  // ── Recorrido guiado ──────────────────────────────────────────────────────
  const tour = useOnboarding(workspaceId);
  const [setupOpen, setSetupOpen] = useState(false);
  const focusNode = (id: string) => showOnMap({ seed: id, ids: [id], relations: [], query: '' });

  const openChapter = (n: number, ctx: TourContext) => {
    const ch = CHAPTERS.find((c) => c.n === n);
    if (!ch) return;
    const label = `Chapter ${ch.n} · ${ch.title}`;
    if (ch.kind === 'card') {
      setMessages((prev) => [...prev, { role: 'assistant', content: '', card: ch.card, label }]);
    } else {
      handleSend(ch.prompt(ctx), label);
    }
  };
  const tourCtx = (): TourContext | null =>
    tour.state ? { role: tour.state.role, task: tour.state.task } : null;

  const topSlot = setupOpen ? (
    <div className="border-b border-border p-3">
      <TourSetup
        onCancel={() => setSetupOpen(false)}
        onStart={(role, task) => {
          tour.start(role, task);
          setSetupOpen(false);
          openChapter(1, { role, task: task.trim() || DEFAULT_TASK });
        }}
      />
    </div>
  ) : tour.state && tour.state.current !== null ? (
    <TourBar
      state={tour.state}
      busy={ask.isPending}
      onGo={(n) => {
        const ctx = tourCtx();
        tour.goTo(n);
        if (ctx) openChapter(n, ctx);
      }}
      onFinish={tour.finish}
      onLeave={tour.leave}
    />
  ) : tour.state ? (
    <div
      className="flex items-center justify-between border-b border-border px-4 py-2 text-[11px]"
      data-testid="tour-done"
    >
      <span className="text-success">
        ✓ Tour complete: you can keep asking, or go back over a chapter.
      </span>
      <button
        type="button"
        onClick={() => setSetupOpen(true)}
        className="text-accent hover:underline"
      >
        Restart
      </button>
    </div>
  ) : null;

  const panel = (
    <ChatPanel
      topSlot={topSlot}
      progress={ask.progress}
      renderCard={(card) =>
        card === 'orient' ? (
          <OrientCard workspaceId={workspaceId} onSelect={focusNode} />
        ) : card === 'docs' ? (
          <DocsCard
            workspaceId={workspaceId}
            onExplain={(d) =>
              handleSend(
                explainDocPrompt(d, tour.state?.task ?? DEFAULT_TASK),
                `Reading · ${d.title || d.path}`,
              )
            }
          />
        ) : (
          <DoorsCard workspaceId={workspaceId} onSelect={focusNode} />
        )
      }
      onStartTour={() => setSetupOpen(true)}
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
      docked={docked}
      {...(docked ? { onClose: () => setChatOpen(false) } : {})}
    />
  );

  if (docked) {
    return chatOpen ? (
      <>
        {!wideDock && (
          <button
            type="button"
            aria-label="Dismiss assistant"
            className="fixed inset-0 z-40 cursor-default bg-black/30"
            onClick={() => setChatOpen(false)}
          />
        )}
        <aside
          className={
            wideDock
              ? 'h-full w-[22rem] shrink-0 border-l border-border'
              : 'fixed inset-y-0 right-0 z-50 h-full w-[22rem] max-w-[calc(100vw-2rem)] border-l border-border shadow-2xl'
          }
          aria-label="Assistant"
        >
          {panel}
        </aside>
      </>
    ) : (
      <button
        type="button"
        onClick={() => setChatOpen(true)}
        aria-label="Ask the architecture"
        className="h-full w-9 shrink-0 border-l border-border bg-surface py-4 text-xs text-accent [writing-mode:vertical-rl] hover:bg-bg"
      >
        Ask the architecture
      </button>
    );
  }

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
        <div className="fixed bottom-20 right-6 z-30 w-[26rem] h-[36rem] max-h-[75vh]">{panel}</div>
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
      // El recorrido se vuelve a dibujar al recargar la conversación.
      ...(t.roadmap ? { roadmap: t.roadmap } : {}),
      status: t.status,
    },
  ]);
}
