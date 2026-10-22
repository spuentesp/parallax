import type * as React from 'react';
import { useParams } from 'react-router-dom';
import { EvidencePanel } from '../components/EvidencePanel.js';
import { SAMPLE_TOPOLOGY } from './OrgLayout.js';

export function Service(): React.ReactElement {
  const { serviceId } = useParams();
  const known = SAMPLE_TOPOLOGY.nodes.some((n) => n.id === serviceId);

  if (!known) {
    return (
      <section>
        <h2>Servicio no encontrado</h2>
        <p className="text-sm text-muted">No existe «{serviceId}» en esta topología.</p>
        <p className="text-xs text-muted">Cierra el panel para volver al hub.</p>
      </section>
    );
  }

  return (
    <section>
      <h2>Service {serviceId}</h2>
      <EvidencePanel />
    </section>
  );
}
