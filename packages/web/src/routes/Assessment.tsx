import type * as React from 'react';
import { useParams } from 'react-router-dom';
import { AssessmentView } from '../components/AssessmentView.js';
import { CoverageBadge } from '../components/CoverageBadge.js';

export function Assessment(): React.ReactElement {
  const { assessmentId } = useParams();
  if (!assessmentId) return <p>Assessment id missing</p>;
  return (
    <section>
      <CoverageBadge coverage={{ reviewed: [], omitted: [], refsUnresolved: [], truncated: [] }} />
      <AssessmentView assessmentId={assessmentId} />
    </section>
  );
}
