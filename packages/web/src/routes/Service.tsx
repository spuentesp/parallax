import type * as React from 'react';
import { useParams } from 'react-router-dom';
import { EvidencePanel } from '../components/EvidencePanel.js';

export function Service(): React.ReactElement {
  const { serviceId } = useParams();
  return (
    <section>
      <h2>Service {serviceId}</h2>
      <EvidencePanel />
    </section>
  );
}
