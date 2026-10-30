import type * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownMessage({ content }: { content: string }): React.ReactElement {
  return (
    <div
      className="space-y-3 leading-relaxed [overflow-wrap:anywhere]"
      data-testid="assistant-markdown"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-base font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="text-[15px] font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold">{children}</h3>,
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              className="font-medium text-accent underline underline-offset-2"
              {...(href?.startsWith('http')
                ? { target: '_blank', rel: 'noopener noreferrer' }
                : {})}
            >
              {children}
            </a>
          ),
          code: ({ className, children }) => (
            <code
              className={`rounded bg-surface px-1 py-0.5 font-mono text-[0.85em] ${className ?? ''}`}
            >
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-xs">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-accent/50 pl-3 text-muted">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-border" />,
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-left text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border bg-surface px-2.5 py-2 font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="px-2.5 py-2 align-top">{children}</td>,
          input: (props) => <input {...props} className="mr-1.5 accent-accent" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
