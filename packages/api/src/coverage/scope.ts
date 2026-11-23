// One Lain federation can back several Parallax workspaces (the Fly demo serves two NVIDIA clusters
// from one engine). The engine reports every repo it holds; a workspace should only show its own.

interface RepoRow {
  id: string;
  uri: string;
  local: string | null;
}

const norm = (s: string): string => s.toLowerCase().replace(/\.git$/, '');
const last = (s: string): string => norm(s.split(/[\\/]/).filter(Boolean).pop() ?? '');

/** Names a workspace's repos go by, in every spelling the engine might use. */
export function workspaceRepoNames(rows: readonly RepoRow[]): Set<string> {
  const names = new Set<string>();
  for (const r of rows) {
    names.add(norm(r.id));
    names.add(last(r.uri));
    if (r.local) names.add(last(r.local));
  }
  return names;
}

/**
 * Keep the engine repos that belong to the workspace. If none matches (the DB uses other names than the
 * engine), keep them all rather than show an empty page: that is the behaviour before scoping existed.
 */
export function scopeToWorkspace<T>(
  items: readonly T[],
  repoOf: (item: T) => string | null,
  rows: readonly RepoRow[],
): T[] {
  const names = workspaceRepoNames(rows);
  if (names.size === 0) return [...items];
  const kept = items.filter((i) => {
    const r = repoOf(i);
    return r !== null && names.has(norm(r));
  });
  return kept.length > 0 ? kept : [...items];
}
