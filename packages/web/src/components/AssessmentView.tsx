import type * as React from 'react';

export function AssessmentView({
  assessmentId,
}: {
  assessmentId: string;
}): React.ReactElement {
  return (
    <article>
      <h2>Assessment {assessmentId}</h2>
      <p style={{ color: '#64748b' }}>Estado y contenido: subproject 3</p>
    </article>
  );
}
