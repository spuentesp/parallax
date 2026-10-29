import { useQuery } from '@tanstack/react-query';
import type * as React from 'react';
import { useState } from 'react';
import { fetchGraphSnippet } from '../api/hooks.js';

// "View source": abre el código en la vista del motor (explain_symbol /
// get_code_snippet). Sólo pide al pulsar — no hay que traer el código de cada
// nodo que se mira — y un fallo del motor se dice, no se esconde.
export function SourcePeek({
  workspaceId,
  repo,
  target,
}: {
  workspaceId: string;
  repo: string;
  target: string | { path: string };
}): React.ReactElement {
  const [wanted, setWanted] = useState(false);
  const key = typeof target === 'string' ? target : `path:${target.path}`;
  const q = useQuery({
    queryKey: ['map-source', workspaceId, repo, key],
    queryFn: () => fetchGraphSnippet(workspaceId, repo, target),
    enabled: wanted,
    staleTime: 5 * 60_000,
  });
  const snippet = q.data?.snippet;
  const failure =
    q.isError || q.data?.source === 'error'
      ? (q.data?.error ?? 'could not load the source')
      : snippet?.error;

  return (
    <div className="space-y-2">
      {!wanted && (
        <button
          type="button"
          onClick={() => setWanted(true)}
          className="px-2.5 py-1 rounded-full text-xs bg-bg text-muted border border-border hover:bg-border"
        >
          View source
        </button>
      )}
      {wanted && q.isPending && <p className="text-xs text-muted">Loading source…</p>}
      {failure && <p className="text-xs text-warning">{failure}</p>}
      {snippet?.text && (
        <>
          {snippet.path && (
            <p className="font-mono text-[11px] text-muted break-all">{snippet.path}</p>
          )}
          <pre
            data-testid="source-peek"
            className="max-h-72 overflow-auto rounded-lg border border-border bg-bg p-3 text-[11px] leading-5 font-mono whitespace-pre"
          >
            {snippet.text}
          </pre>
        </>
      )}
    </div>
  );
}
