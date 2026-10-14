import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
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
      className="flex flex-col h-full rounded-xl"
      style={{
        background: 'var(--color-surface, #171717)',
        border: '1px solid var(--color-border, #262626)',
      }}
    >
      {/* Header */}
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--color-border, #262626)' }}>
        <div className="text-sm font-semibold">Architecture Assistant</div>
        <div className="text-xs" style={{ color: 'var(--color-muted, #a3a3a3)' }}>
          Ask about your codebase topology
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div
            className="text-center text-sm py-8"
            style={{ color: 'var(--color-muted, #a3a3a3)' }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>◈</div>
            <div>Ask something like:</div>
            <div style={{ fontStyle: 'italic', marginTop: 4 }}>
              &quot;Do we have microservices that handle customer data?&quot;
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={`${m.role}-${m.content.slice(0, 30)}`}
            className="flex"
            style={{ justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}
          >
            <div
              className="rounded-xl px-3 py-2 text-sm max-w-[85%]"
              style={{
                background:
                  m.role === 'user' ? 'var(--color-accent, #3b82f6)' : 'var(--color-bg, #0a0a0a)',
                color: m.role === 'user' ? '#fff' : 'var(--color-fg, #fafafa)',
                border: m.role === 'user' ? 'none' : '1px solid var(--color-border, #262626)',
              }}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div
            className="flex items-center gap-2 text-sm"
            style={{ color: 'var(--color-muted, #a3a3a3)' }}
          >
            <div
              className="animate-pulse w-2 h-2 rounded-full"
              style={{ background: 'var(--color-accent, #3b82f6)' }}
            />
            Investigating…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-4" style={{ borderTop: '1px solid var(--color-border, #262626)' }}>
        <div
          className="flex gap-2 rounded-lg p-2"
          style={{ background: 'var(--color-bg, #0a0a0a)' }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="Ask about your architecture…"
            className="flex-1 text-sm"
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--color-fg, #fafafa)',
            }}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !input.trim()}
            className="px-3 py-1 rounded-md text-sm font-medium transition-opacity"
            style={{
              background: loading ? 'var(--color-muted, #a3a3a3)' : 'var(--color-accent, #3b82f6)',
              color: '#fff',
              opacity: loading ? 0.5 : 1,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
