import type * as React from 'react';
import { useParams } from 'react-router-dom';

export function Proposal(): React.ReactElement {
  const { proposalId } = useParams();
  return <h2>Architecture Proposal {proposalId}</h2>;
}
