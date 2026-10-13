import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ServiceMap } from '../components/ServiceMap.js';
import { EvidencePanel } from '../components/EvidencePanel.js';
import { AssessmentView } from '../components/AssessmentView.js';

afterEach(() => cleanup());

describe('stub components', () => {
  it('ServiceMap shows the map label', () => {
    render(<ServiceMap />);
    expect(screen.getByRole('region', { name: /service map/i })).toBeTruthy();
  });
  it('EvidencePanel shows the empty hint', () => {
    render(<EvidencePanel />);
    expect(screen.getByRole('list', { name: /evidence/i })).toBeTruthy();
  });
  it('AssessmentView shows the assessment id', () => {
    render(<AssessmentView assessmentId="a_1" />);
    expect(screen.getByRole('article').textContent).toContain('a_1');
  });
});
