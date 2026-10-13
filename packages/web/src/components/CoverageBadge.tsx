import type { Coverage } from '@parallax/shared/domain';

export function CoverageBadge({ coverage }: { coverage: Coverage }): JSX.Element {
  const reviewed = coverage.reviewed.length;
  const omitted = coverage.omitted.length;
  const truncated = coverage.truncated.length;
  const unresolved = coverage.refsUnresolved.length;

  if (reviewed === 0) {
    return (
      <span
        role="status"
        style={{
          background: '#dc2626',
          color: 'white',
          padding: '2px 8px',
          borderRadius: 4,
          fontSize: 12,
        }}
      >
        sin datos
      </span>
    );
  }
  if (omitted > 0 || truncated > 0 || unresolved > 0) {
    return (
      <span
        role="status"
        title={`omitted=${omitted} truncated=${truncated} unresolved=${unresolved}`}
        style={{
          background: '#d97706',
          color: 'white',
          padding: '2px 8px',
          borderRadius: 4,
          fontSize: 12,
        }}
      >
        cobertura parcial ({reviewed} revisados, {omitted} omitidos)
      </span>
    );
  }
  return (
    <span
      role="status"
      style={{
        background: '#16a34a',
        color: 'white',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      completa ({reviewed} revisados)
    </span>
  );
}
