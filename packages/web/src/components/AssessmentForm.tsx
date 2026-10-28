import type * as React from 'react';
import { useState } from 'react';
import { useCreateAssessment } from '../api/hooks.js';

export function AssessmentForm({
  orgId,
  preselectedRepo,
}: {
  orgId: string;
  preselectedRepo?: string | undefined;
}): React.ReactElement {
  const { mutate } = useCreateAssessment();
  const [repo, setRepo] = useState(preselectedRepo ?? '');
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');

  return (
    <form
      className="rounded-xl p-4 bg-surface border border-border space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        mutate({ repo, base, head, orgId });
      }}
    >
      <div className="text-sm font-semibold">Nueva evaluación de PR</div>
      <label className="block text-xs text-muted">
        Repo
        <input
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 font-mono text-sm"
        />
      </label>
      <label className="block text-xs text-muted">
        Base SHA
        <input
          value={base}
          onChange={(e) => setBase(e.target.value)}
          className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 font-mono text-sm"
        />
      </label>
      <label className="block text-xs text-muted">
        Head SHA
        <input
          value={head}
          onChange={(e) => setHead(e.target.value)}
          className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 font-mono text-sm"
        />
      </label>
      <button type="submit" className="text-xs px-3 py-1.5 rounded-lg bg-accent text-accent-fg">
        Evaluar
      </button>
    </form>
  );
}
