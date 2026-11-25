import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const NAME = /^[\w.-]+$/;
const SHA = /^[0-9a-f]{40}$/;
const GIT_TIMEOUT_MS = 120_000;

export class PrRefsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrRefsError';
  }
}

export interface PrRefsInput {
  // Checkout local del repo (el que Lain lee como workspace_dir).
  localDir: string;
  // Base de remotos, p. ej. https://github.com
  remoteBase: string;
  owner: string;
  repo: string;
  number: number;
  baseSha: string;
  headSha: string;
}

// El motor lee la base y la cabeza de un PR desde ramas del checkout, no desde SHAs sueltos.
// Trae los dos commits (superficiales) y crea una rama por cada uno. Sin shell: los argumentos
// van como arreglo y todo lo que viene de fuera se valida antes.
export async function fetchPrRefs(input: PrRefsInput): Promise<{ base: string; head: string }> {
  const { localDir, remoteBase, owner, repo, number, baseSha, headSha } = input;
  if (!NAME.test(owner) || !NAME.test(repo)) throw new PrRefsError('invalid owner or repo');
  if (!Number.isInteger(number) || number < 1) throw new PrRefsError('invalid pull request number');
  if (!SHA.test(baseSha) || !SHA.test(headSha)) throw new PrRefsError('invalid commit sha');

  const url = `${remoteBase.replace(/\/+$/, '')}/${owner}/${repo}.git`;
  const git = (...args: string[]) =>
    run('git', ['-C', localDir, ...args], {
      timeout: GIT_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' },
    });

  const base = `parallax-pr-${String(number)}-base`;
  const head = `parallax-pr-${String(number)}-head`;
  try {
    await git('fetch', '--quiet', '--depth', '1', url, baseSha);
    await git('branch', '-f', base, baseSha);
    // La cabeza de un PR de fork sólo está garantizada en refs/pull/N/head del repo base.
    await git('fetch', '--quiet', '--depth', '1', url, `refs/pull/${String(number)}/head`);
    const { stdout } = await git('rev-parse', 'FETCH_HEAD');
    if (stdout.trim() !== headSha) {
      // El PR avanzó o no coincide con lo que GitHub informó: no se analiza otra cosa.
      throw new PrRefsError(
        `pull request head moved: expected ${headSha}, fetched ${stdout.trim()}`,
      );
    }
    await git('branch', '-f', head, headSha);
  } catch (e) {
    if (e instanceof PrRefsError) throw e;
    throw new PrRefsError(`git fetch failed for ${owner}/${repo}#${String(number)}`);
  }
  return { base, head };
}
