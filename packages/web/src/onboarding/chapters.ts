// El recorrido guiado: capítulos de UNA conversación larga. Los dos primeros se
// responden sin modelo (el mapa lo sabe); el resto son preguntas guionizadas que
// van al investigador, con el rol y la tarea del recién llegado dentro, y cuyas
// afirmaciones el motor verifica. Diseño: docs/superpowers/specs/
// 2026-10-28-conversation-orientation-knowledge-design.md §11.

export type Role = 'frontend' | 'backend' | 'fullstack';

export const ROLE_LABEL: Record<Role, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  fullstack: 'Full-stack',
};

export interface TourContext {
  role: Role;
  task: string;
}

export type Chapter =
  | { n: number; title: string; asks: string; kind: 'card'; card: 'orient' | 'doors' | 'docs' }
  | { n: number; title: string; asks: string; kind: 'ask'; prompt: (c: TourContext) => string };

const EVIDENCE =
  'Give every file as path:line copied EXACTLY as the tool printed it (do not shorten or re-prefix the path; the line must be one you saw in a tool result, never a guess) and add a location claim for each so the engine can read it back. Be brief and start with the finding, not with a restatement of my question. Say plainly what you could not verify.';

/** Desde dónde se empieza a mirar, según el rol. */
const startFrom = (role: Role): string =>
  role === 'frontend'
    ? 'Start from the UI code (storefront or dashboard) that makes the request.'
    : role === 'backend'
      ? 'Start from the API operation and its resolver.'
      : 'Start from the UI code that makes the request and follow it into the API.';

export const CHAPTERS: Chapter[] = [
  {
    n: 1,
    title: 'Orient',
    asks: 'What is this system and how big is it?',
    kind: 'card',
    card: 'orient',
  },
  {
    n: 2,
    title: 'The doors',
    asks: 'What can talk to it, and who uses what?',
    kind: 'card',
    card: 'doors',
  },
  {
    n: 3,
    title: 'Follow a request',
    asks: 'What really happens when someone does this?',
    kind: 'ask',
    prompt: ({ role, task }) =>
      `My task is: "${task}". Pick the EXISTING request that is closest to what my task needs (if my task is a new feature, the nearest feature that already works; say which one you chose and why) and trace it across the repositories in at most five hops: the UI code that starts it, the API operation that receives it, the resolver, the domain function, and (only if you actually find one) a side effect or background task. Stop at the first hop you cannot find and say so. ${startFrom(role)} ${EVIDENCE}`,
  },
  {
    n: 4,
    title: 'What would break',
    asks: 'If I change that code, what else breaks?',
    kind: 'ask',
    prompt: ({ task }) =>
      `For my task ("${task}"), which existing functions would I most likely change, and what depends on them? Use the blast radius and callers: name the dependents (including in other repositories), the ones that have no tests, and any file that usually changes together with them. ${EVIDENCE}`,
  },
  {
    n: 5,
    title: 'What the team wrote down',
    asks: 'What did the team decide and document that I must respect?',
    kind: 'card',
    card: 'docs',
  },
  {
    n: 6,
    title: 'How we work here',
    asks: 'How do I run, test and contribute? Who owns this?',
    kind: 'ask',
    prompt: () =>
      "Read the repositories' own documentation (README, CONTRIBUTING, CODEOWNERS, docs/) with the code tools and tell me: how to run the tests, the contribution conventions, and who owns the core services and contracts. Mark everything you report as documented (it comes from those files, not from analysis) and say which of those files you could not find.",
  },
  {
    n: 7,
    title: 'Vocabulary',
    asks: 'What do these words mean here?',
    kind: 'ask',
    prompt: ({ task }) =>
      `Give me the eight domain terms I must understand for my task ("${task}"). For each: a one-line meaning taken from the repositories' own documentation (glossary, CONTEXT.md, domain docs, README) when it exists, and the class or model that implements it (path:line). Mark each meaning as documented or as inferred from code. Skip generic programming words. ${EVIDENCE}`,
  },
  {
    n: 8,
    title: 'Your task',
    asks: 'So where do I start?',
    kind: 'ask',
    prompt: ({ role, task }) =>
      `I need to: "${task}". (1) Which existing feature is the closest one to copy, and where does it live? (2) List the touchpoints I must change, per repository, with path:line. (3) Which tests should I write or extend? (4) What is risky: dependents, other repositories that consume what I touch, and anything unresolved nearby. ${startFrom(role)} ${EVIDENCE}`,
  },
];

/** Pedir que se LEA un documento concreto (el modelo no tiene que buscarlo) y se relacione con el código. */
export const explainDocPrompt = (d: { repo: string; path: string }, task: string): string =>
  `Read ${d.path} in the ${d.repo} repository with get_code_snippet: it is documentation the team wrote. Explain it to a new engineer: (1) the rules or decisions it sets, in at most four bullets, each quoting the line it comes from; (2) why the team wanted that, as the document says it; (3) where in the code those rules are enforced or obeyed (path:line), or say you could not find it. Only at the end, in ONE sentence, say whether it touches my task ("${task}"); do not dwell on the task and do not describe the workspace map. Mark what the document says as documented and what you see in code as observed; if they disagree, say so. ${EVIDENCE}`;

export const DEFAULT_TASK = 'Add a delivery note to checkout';

export function defaultTaskForWorkspace(workspaceId?: string | null): string {
  if (workspaceId?.includes('openshell')) {
    return 'Add telemetry and auth checks to sandbox creation in the gateway';
  }
  if (workspaceId?.includes('nat')) {
    return 'Add authentication middleware to the agent actions endpoint';
  }
  return DEFAULT_TASK;
}

export function suggestedTasksForWorkspace(workspaceId?: string | null): string[] {
  if (workspaceId?.includes('openshell')) {
    return [
      'Add telemetry and auth checks to sandbox creation in the gateway',
      'Trace sandbox exec requests from python SDK to gateway',
      'Audit session state and table mutations in nemoclaw',
    ];
  }
  if (workspaceId?.includes('nat')) {
    return [
      'Add authentication middleware to the agent actions endpoint',
      'Trace agent chat workflow from UI to toolkit backend',
      'Expose health and readiness metrics for toolkit workflows',
    ];
  }
  return [
    'Add a delivery note to checkout',
    'Add an export button to orders table',
  ];
}
