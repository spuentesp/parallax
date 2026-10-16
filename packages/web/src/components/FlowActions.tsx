import type * as React from 'react';
import { Link } from 'react-router-dom';

export function FlowActions({
  orgId,
  selectedNode,
}: {
  orgId: string;
  selectedNode?: { id: string; kind: string } | undefined;
}): React.ReactElement {
  const repo = selectedNode?.kind === 'service' ? selectedNode.id : '';
  return (
    <div className="flex flex-wrap gap-2 mb-6">
      <Link
        to="/workspaces"
        className="text-xs px-3 py-1.5 rounded-lg bg-surface border border-border"
      >
        Configurar workspace
      </Link>
      <Link
        to={`/orgs/${orgId}/assessments?repo=${encodeURIComponent(repo)}`}
        className="text-xs px-3 py-1.5 rounded-lg bg-accent text-accent-fg"
      >
        Evaluar PR
      </Link>
      <Link
        to={`/orgs/${orgId}/assessments`}
        className="text-xs px-3 py-1.5 rounded-lg bg-surface border border-border"
      >
        Ver evaluaciones
      </Link>
    </div>
  );
}
