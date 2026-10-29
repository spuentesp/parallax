import type * as React from 'react';
import { Link } from 'react-router-dom';
import type { NodeContext } from '../map/nodeId.js';

export function FlowActions({
  orgId,
  selectedNode,
}: {
  orgId: string;
  selectedNode?: NodeContext | null | undefined;
}): React.ReactElement {
  // Un PR se evalúa contra un repo o servicio concreto: lo seleccionado en el
  // mapa precarga el formulario.
  const repo = selectedNode?.name ?? '';
  return (
    <div className="flex flex-wrap gap-2">
      <Link
        to={`/orgs/${orgId}/assessments?repo=${encodeURIComponent(repo)}`}
        className="text-xs px-3 py-1.5 rounded-lg bg-accent text-accent-fg"
      >
        Evaluate PR{repo ? ` · ${repo}` : ''}
      </Link>
    </div>
  );
}
