// ChatPanel — conversational interface for architectural questions.
// User asks "do we have microservices that do X?" and receives a
// topology + natural language answer.

import { useEffect, useRef, useState } from 'react';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  topology?: { nodes: unknown[]; edges: unknown[] };
}

export function ChatPanel({
  messages,
  onSend,
  loading,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  loading: boolean;
}): React.ReactElement {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, []);

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || loading) return;
    onSend(text);
    setInput('');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#1e293b',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {messages.length === 0 && (
          <p style={{ color: '#64748b', textAlign: 'center', marginTop: 40 }}>
            Pregunta algo como: &quot;¿tenemos microservicios que hagan X?&quot;
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.content.slice(0, 30) + m.role}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '80%',
              padding: '8px 12px',
              borderRadius: 8,
              background: m.role === 'user' ? '#3b82f6' : '#334155',
              color: '#fff',
              fontSize: 14,
              whiteSpace: 'pre-wrap',
            }}
          >
            {m.content}
          </div>
        ))}
        {loading && (
          <div style={{ color: '#64748b', fontSize: 13, fontStyle: 'italic' }}>Investigando…</div>
        )}
        <div ref={bottomRef} />
      </div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: 12,
          borderTop: '1px solid #334155',
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="Pregunta arquitectónica…"
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid #475569',
            background: '#0f172a',
            color: '#fff',
            fontSize: 14,
          }}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || !input.trim()}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            background: loading ? '#475569' : '#3b82f6',
            color: '#fff',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? '…' : 'Enviar'}
        </button>
      </div>
    </div>
  );
}
