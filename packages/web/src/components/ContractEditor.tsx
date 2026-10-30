import { ContractApplyBody, type ContractApplyResult } from '@parallax/shared/domain';
import type * as React from 'react';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApplyContractRemediation, useWhoami } from '../api/hooks.js';

const INITIAL_CONTEXT = JSON.stringify(
  {
    provides: [
      {
        service: 'api',
        key: 'http:GET /orders',
        source: 'Parallax contract editor',
      },
    ],
    host_aliases: [],
    bindings: [],
  },
  null,
  2,
);

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { detail?: string } | null;
    return body?.detail ?? `request failed (${error.status})`;
  }
  return error instanceof Error ? error.message : 'request failed';
}

export function ContractEditor({ workspaceId }: { workspaceId: string }): React.ReactElement {
  const [contextText, setContextText] = useState(INITIAL_CONTEXT);
  const [validationError, setValidationError] = useState('');
  const [result, setResult] = useState<ContractApplyResult | null>(null);
  const mutation = useApplyContractRemediation();
  const readOnly = useWhoami().data?.readOnly === true;

  const apply = (dryRun: boolean) => {
    setValidationError('');
    let raw: unknown;
    try {
      raw = JSON.parse(contextText);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : 'invalid JSON');
      return;
    }
    const parsed = ContractApplyBody.safeParse({
      snapshot: 'live',
      ...(typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}),
      dry_run: dryRun,
    });
    if (!parsed.success) {
      setValidationError(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      );
      return;
    }
    mutation.mutate({ workspaceId, body: parsed.data }, { onSuccess: setResult });
  };

  return (
    <section
      className="rounded-xl border border-border bg-surface p-4 space-y-4"
      data-testid="contract-editor"
    >
      <div>
        <h2 className="font-semibold">Contract remediation</h2>
        <p className="text-xs text-muted mt-1">
          Declare providers, host aliases, and bindings in Lain. Dry-run returns the exact YAML;
          apply validates and writes it atomically with a backup.
        </p>
      </div>
      <label className="block text-xs text-muted">
        Context JSON
        <textarea
          className="mt-1 min-h-56 w-full rounded border border-border bg-bg p-3 font-mono text-sm"
          value={contextText}
          onChange={(event) => setContextText(event.target.value)}
        />
      </label>
      {validationError && <p className="text-xs text-error">{validationError}</p>}
      {mutation.error && <p className="text-xs text-error">{errorText(mutation.error)}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50"
          disabled={readOnly || mutation.isPending}
          onClick={() => apply(true)}
        >
          Preview changes
        </button>
        <button
          type="button"
          className="rounded bg-accent px-3 py-2 text-sm text-accent-fg disabled:opacity-50"
          disabled={readOnly || mutation.isPending}
          onClick={() => apply(false)}
        >
          Apply changes
        </button>
      </div>
      {result && (
        <div>
          <h3 className="text-sm font-semibold" data-testid="remediation-result">
            {result.applied ? 'Applied by Lain' : 'Dry-run preview'}
          </h3>
          {result.note && <p className="text-xs text-muted mt-1">{result.note}</p>}
          {result.backup && <p className="text-xs text-muted mt-1">Backup: {result.backup}</p>}
          <pre
            className="mt-2 max-h-80 overflow-auto rounded bg-bg p-3 text-xs"
            data-testid="contract-preview"
          >
            {result.yaml ?? JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
