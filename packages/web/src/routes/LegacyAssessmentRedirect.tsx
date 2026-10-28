import type * as React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAssessment } from '../api/hooks.js';

// Compatibilidad: /assessments/:id no trae orgId — se resuelve del registro.
export function LegacyAssessmentRedirect(): React.ReactElement {
  const { assessmentId } = useParams();
  const { data, isPending, isError } = useAssessment(assessmentId ?? null);

  if (isPending) {
    return <p className="p-6 text-sm text-muted">Loading…</p>;
  }
  if (isError || !data?.assessment) {
    return <p className="p-6 text-sm text-error">Assessment not found</p>;
  }
  return (
    <Navigate to={`/orgs/${data.assessment.orgId}/assessments/${data.assessment.id}`} replace />
  );
}
