// Words and colours for the panel. Pure, so the wording rules can be tested.

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// One sentence about what the ticket's words point at.
export function expectedLine(summary) {
  if (!summary || summary.targets === 0) {
    return 'This ticket names no service or endpoint that Parallax knows.';
  }
  const parts = [`Names ${plural(summary.targets, 'thing')} in the architecture`];
  if (summary.consumers === 0) {
    parts.push('nothing else depends on them');
  } else {
    let consumers = plural(summary.consumers, 'consumer');
    if (summary.provenByCode === summary.consumers) consumers += ', all proven by code';
    else if (summary.provenByCode > 0) consumers += `, ${summary.provenByCode} proven by code`;
    parts.push(consumers);
    if (summary.inferredOnly > 0) parts.push(`${summary.inferredOnly} inferred only`);
  }
  return `${parts.join(' · ')}.`;
}

// How alarmed the headline colour should be.
//   good    : the PR did what the ticket said
//   notice  : worth a look
//   warning : the PR and the ticket disagree, or risky code changed
//   neutral : nothing to report
export function driftTone(drift) {
  if (!drift) return 'neutral';
  switch (drift.verdict) {
    case 'aligned':
      return 'good';
    case 'code-only':
      return drift.codeChanges?.highestRisk === 'high' ? 'warning' : 'notice';
    case 'wider-than-ticket':
    case 'different':
    case 'ticket-named-nothing':
      return 'warning';
    case 'pr-touched-no-contracts':
      return 'neutral';
    default:
      return 'notice';
  }
}

// A short label for the state of an assessment.
export function statusLabel(status, coverageComplete) {
  if (status === 'READY') return coverageComplete ? 'Complete' : 'Ready, coverage incomplete';
  if (status === 'PARTIAL') return 'Partial';
  return status ?? 'Unknown';
}

// "3 verified · 9 need investigation": only the non-zero classes, in order of weight.
export function countsLine(counts) {
  const out = [];
  if (counts?.verified) out.push(`${counts.verified} verified`);
  if (counts?.needsInvestigation) out.push(`${counts.needsInvestigation} need investigation`);
  if (counts?.noKnownImpact) out.push(`${counts.noKnownImpact} no known impact`);
  // Methods the engine could not compare are not findings; they are listed last and never
  // folded into "need investigation".
  if (counts?.couldNotCompare) out.push(`${counts.couldNotCompare} could not be compared`);
  return out.length ? out.join(' · ') : 'no contract findings';
}

// "NVIDIA/NemoClaw#13812" -> a link to it, from the stored PR reference.
export function prUrl(prRef) {
  const m = String(prRef ?? '').match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
  return m ? `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}` : null;
}

// How far a finding reaches, as a phrase. Only a proven finding has *consumers*; for the rest
// the engine found *possible call sites* it could not bind, and calling those consumers would
// overstate what is known.
export function reachLine(finding) {
  const n = finding?.affectedDistinct ?? 0;
  if (n === 0) return 'no consumers found';
  const noun = finding.class === 'Verified' ? 'consumer' : 'possible call site';
  const repos = Object.keys(finding.affectedByRepo ?? {});
  return `${plural(n, noun)}${repos.length ? ` in ${repos.join(', ')}` : ''}`;
}
