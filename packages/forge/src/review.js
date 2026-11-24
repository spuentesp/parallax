// Pairs what a ticket PREDICTED with what its pull request ACTUALLY touched.
//
// Pure functions, no network. Input shapes come from Parallax:
//   - expected : the result of resolve.js expectedImpact()  (a prediction from words)
//   - assessment: GET /api/assessments/:id                   (an analysis of real commits)
//
// Two honesty rules run through this file:
//   1. An assessment with incomplete coverage never counts as "no impact".
//   2. A prediction from text is never presented as proof; "drift" only says the ticket and the
//      PR disagree, and which side the disagreement is on.

const CLASS_ORDER = { Verified: 0, NeedsInvestigation: 1, NoKnownImpact: 2 };
const MAX_FINDINGS = 12;
const MAX_NARRATIVE_CHARS = 700;
const MAX_SYMBOLS = 5;

// GitHub pull request URLs found in free text, without duplicates.
export function extractPrRefs(text) {
  const seen = new Set();
  const refs = [];
  for (const m of String(text ?? '').matchAll(
    /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/gi,
  )) {
    const key = `${m[1]}/${m[2]}#${m[3]}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ owner: m[1], repo: m[2], number: Number(m[3]), url: m[0] });
  }
  return refs;
}

// Does this assessment analyse the given pull request?
export function assessmentMatchesPr(assessment, ref) {
  const pr = assessment?.manifest?.pr;
  return (
    !!pr &&
    String(pr.owner).toLowerCase() === ref.owner.toLowerCase() &&
    String(pr.repo).toLowerCase() === ref.repo.toLowerCase() &&
    Number(pr.number) === ref.number
  );
}

// The same consumer can be reported many times (one row per call site). Count it once.
function distinctAffected(affected) {
  const seen = new Map();
  for (const a of affected ?? []) {
    const key = `${a.service}|${a.consumer}|${a.class}`;
    if (!seen.has(key)) seen.set(key, a);
  }
  return [...seen.values()];
}

const countBy = (items, pick) => {
  const out = {};
  for (const it of items) out[pick(it)] = (out[pick(it)] ?? 0) + 1;
  return out;
};

// A compact, honest view of one assessment.
export function summarizeAssessment(assessment) {
  const findings = (assessment.findings ?? []).map((f) => {
    const distinct = distinctAffected(f.affected);
    return {
      endpoint: f.endpoint?.key,
      service: f.endpoint?.service,
      change: f.kind,
      compat: f.compat,
      class: f.impact?.class ?? 'NeedsInvestigation',
      reasons: f.impact?.reasons ?? [],
      affectedTotal: (f.affected ?? []).length,
      affectedDistinct: distinct.length,
      affectedByRepo: countBy(distinct, (a) => a.service ?? '?'),
    };
  });
  findings.sort(
    (a, b) =>
      (CLASS_ORDER[a.class] ?? 9) - (CLASS_ORDER[b.class] ?? 9) ||
      b.affectedDistinct - a.affectedDistinct,
  );

  const counts = {
    verified: findings.filter((f) => f.class === 'Verified').length,
    needsInvestigation: findings.filter((f) => f.class === 'NeedsInvestigation').length,
    noKnownImpact: findings.filter((f) => f.class === 'NoKnownImpact').length,
  };
  const coverageComplete = assessment.coverage?.complete === true;
  const ci = assessment.codeImpact;
  const narrative = assessment.explanation?.narrative;

  return {
    id: assessment.id,
    status: assessment.status,
    pr: assessment.manifest?.pr
      ? `${assessment.manifest.pr.owner}/${assessment.manifest.pr.repo}#${assessment.manifest.pr.number}`
      : null,
    counts,
    coverage: {
      complete: coverageComplete,
      reviewed: assessment.coverage?.scope?.reviewed ?? [],
      // Spanish in the source data; the rule it states is the point, so it is restated here.
      note: coverageComplete
        ? 'Coverage is complete.'
        : 'Coverage is incomplete: an empty result does not prove there is no impact.',
    },
    findings: findings.slice(0, MAX_FINDINGS),
    findingsTotal: findings.length,
    codeImpact: ci
      ? {
          repo: ci.repo,
          filesChanged: ci.filesChanged,
          filesAnalyzed: ci.filesAnalyzed,
          highestRisk: ci.highestRisk,
          symbolsTotal: (ci.symbols ?? []).length,
          untestedTotal: (ci.symbols ?? []).filter((s) => s.untested).length,
          // Riskiest first, untested before tested, so the few shown are the ones that matter.
          symbols: [...(ci.symbols ?? [])]
            .sort(
              (a, b) =>
                (RISK_ORDER[a.risk] ?? 9) - (RISK_ORDER[b.risk] ?? 9) ||
                Number(!!b.untested) - Number(!!a.untested),
            )
            .slice(0, MAX_SYMBOLS)
            .map((s) => ({
              name: s.name,
              path: s.path,
              line: s.line,
              change: s.change,
              risk: s.risk,
              untested: s.untested,
            })),
        }
      : null,
    explanation: narrative
      ? {
          model: assessment.explanation.model,
          text:
            narrative.length > MAX_NARRATIVE_CHARS
              ? `${narrative.slice(0, MAX_NARRATIVE_CHARS)}…`
              : narrative,
          note: 'Written by a language model from the findings above; the findings are the evidence.',
        }
      : null,
  };
}

// Compare the prediction with the analysis.
//   expected.targets: [{ node: { kind, label, service? }, matched }]
//   summary.findings: from summarizeAssessment
export function computeDrift(expected, summary) {
  const targets = expected?.targets ?? [];
  const namedEndpoints = new Set(
    targets.filter((t) => t.node?.kind === 'endpoint').map((t) => t.node.label),
  );
  const namedServices = new Set(
    targets
      .map((t) => (t.node?.kind === 'service' ? t.node.label : t.node?.service))
      .filter(Boolean),
  );

  const touched = summary.findings;
  const confirmed = touched.filter((f) => namedEndpoints.has(f.endpoint)).map((f) => f.endpoint);
  const inNamedService = touched.filter(
    (f) => !namedEndpoints.has(f.endpoint) && namedServices.has(f.service),
  );
  const elsewhere = touched.filter(
    (f) => !namedEndpoints.has(f.endpoint) && !namedServices.has(f.service),
  );
  const touchedSet = new Set(touched.map((f) => f.endpoint));
  const missed = [...namedEndpoints].filter((e) => !touchedSet.has(e));

  // Code-level changes are reported even when no contract changed: a PR can edit risky
  // code without touching any published contract.
  const code = summary.codeImpact;
  const codeChanges =
    code && code.symbolsTotal > 0
      ? {
          repo: code.repo,
          symbols: code.symbolsTotal,
          highestRisk: code.highestRisk,
          untested: code.untestedTotal,
          filesChanged: code.filesChanged,
          filesAnalyzed: code.filesAnalyzed,
        }
      : null;

  let verdict;
  if (touched.length === 0) verdict = codeChanges ? 'code-only' : 'pr-touched-no-contracts';
  else if (targets.length === 0) verdict = 'ticket-named-nothing';
  else if (inNamedService.length === 0 && elsewhere.length === 0 && missed.length === 0)
    verdict = 'aligned';
  else if (confirmed.length === 0) verdict = 'different';
  else verdict = 'wider-than-ticket';

  return {
    verdict,
    headline: HEADLINES[verdict]({
      touched: touched.length,
      confirmed: confirmed.length,
      extra: inNamedService.length + elsewhere.length,
      missed: missed.length,
      code: codeChanges,
    }),
    codeChanges,
    confirmed,
    // Ranked: proven impact first, then the ones with the most distinct consumers.
    touchedButNotNamed: [...inNamedService, ...elsewhere]
      .map((f) => ({
        endpoint: f.endpoint,
        service: f.service,
        class: f.class,
        serviceWasNamed: namedServices.has(f.service),
        affectedDistinct: f.affectedDistinct,
        affectedByRepo: f.affectedByRepo,
      }))
      .sort(
        (a, b) =>
          (CLASS_ORDER[a.class] ?? 9) - (CLASS_ORDER[b.class] ?? 9) ||
          b.affectedDistinct - a.affectedDistinct,
      ),
    namedButUntouched: missed,
    // The prediction can only be as good as the words in the ticket.
    caveat: summary.coverage.complete
      ? null
      : 'The assessment has incomplete coverage, so "untouched" does not mean "safe".',
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// One sentence a reader can take in at a glance. Each takes the counts it needs.
const HEADLINES = {
  aligned: ({ touched }) =>
    `The PR touched exactly what the ticket named (${plural(touched, 'contract change')}).`,
  'wider-than-ticket': ({ confirmed, extra }) =>
    `The PR touched ${plural(confirmed, 'contract')} the ticket named, and ${extra} it never mentioned.`,
  different: ({ extra }) =>
    `The PR touched ${plural(extra, 'contract')}, none of them the ones the ticket named.`,
  'ticket-named-nothing': ({ touched }) =>
    `The ticket named no known service or endpoint, but the PR touched ${plural(touched, 'contract change')}.`,
  'pr-touched-no-contracts': ({ missed }) =>
    `The PR changed no contracts${missed ? `, although the ticket named ${missed}` : ''}.`,
  'code-only': ({ code }) =>
    `The PR changed no contracts, but edited ${plural(code.symbols, 'code symbol')} in ${code.repo} ` +
    `(highest risk: ${code.highestRisk}${code.untested ? `; ${code.untested} untested` : ''}).`,
};

// People to talk to: the owners that humans wrote on the Confluence pages of the consumers the
// ticket's targets reach. One entry per service, most critical first.
export function contactsFor(expected) {
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  const byService = new Map();
  for (const t of expected?.targets ?? []) {
    for (const c of t.consumers ?? []) {
      if (c.annotations?.owner && !byService.has(c.service)) {
        byService.set(c.service, {
          service: c.service,
          owner: c.annotations.owner,
          criticality: c.annotations.criticality ?? null,
        });
      }
    }
  }
  return [...byService.values()].sort(
    (a, b) =>
      (rank[String(a.criticality).toLowerCase()] ?? 9) -
        (rank[String(b.criticality).toLowerCase()] ?? 9) || a.service.localeCompare(b.service),
  );
}

const MAX_NEXT_STEPS = 5;
const RISK_ORDER = { high: 0, medium: 1, low: 2 };

// What a reader should do next. Fixed rules over the evidence, never a model's opinion,
// so every line can be traced to a fact above it. `drift` and `summary` are optional
// (a ticket with no linked PR has neither).
export function nextSteps({ expected, drift, summary }) {
  const steps = [];
  const targets = expected?.targets ?? [];

  const contacts = contactsFor(expected).slice(0, 2);
  for (const c of contacts) {
    const crit = c.criticality ? `, ${String(c.criticality).toLowerCase()} criticality` : '';
    steps.push(`Talk to ${c.owner} (owns ${c.service}${crit}) before this ships.`);
  }

  if (targets.length === 0) {
    steps.push(
      'Name the service or endpoint this ticket changes, so Parallax can predict its impact.',
    );
  }

  const unnamed = drift?.touchedButNotNamed?.length ?? 0;
  if (unnamed > 0) {
    const proven = drift.touchedButNotNamed.filter((f) => f.class === 'Verified').length;
    steps.push(
      proven
        ? `${plural(proven, 'contract')} the ticket never named ${proven === 1 ? 'has' : 'have'} proven consumers: confirm the change is intended and update the ticket.`
        : `Check whether the ${plural(unnamed, 'contract')} the ticket did not name ${unnamed === 1 ? 'is' : 'are'} intended; update the ticket or the PR.`,
    );
  }

  const code = drift?.codeChanges;
  if (code) {
    const risky = (summary?.codeImpact?.symbols ?? [])
      .filter((s) => s.risk === 'high' || s.risk === 'medium')
      .sort((a, b) => (RISK_ORDER[a.risk] ?? 9) - (RISK_ORDER[b.risk] ?? 9))[0];
    if (risky) {
      steps.push(
        `Have a second reviewer read ${risky.name} (${risky.path}:${risky.line}): ${risky.risk} risk${risky.untested ? ', untested' : ''}.`,
      );
    }
    if (code.untested > 0) {
      steps.push(
        `Add tests for the ${plural(code.untested, 'untested edited symbol')} in ${code.repo}.`,
      );
    }
  }

  const inferredOnly = targets
    .flatMap((t) => t.consumers ?? [])
    .filter((c) => c.provenance !== 'deterministic')
    .map((c) => c.service);
  const uniqueInferred = [...new Set(inferredOnly)];
  if (uniqueInferred.length > 0) {
    steps.push(
      `Verify the inferred dependency on ${uniqueInferred.slice(0, 3).join(', ')}: it comes from a heuristic, not from proof.`,
    );
  }

  if (summary && !summary.coverage.complete) {
    steps.push(
      'Treat "needs investigation" as open questions: this analysis cannot prove the absence of impact.',
    );
  }

  return steps.slice(0, MAX_NEXT_STEPS);
}
