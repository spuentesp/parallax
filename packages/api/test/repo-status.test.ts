import { describe, expect, it } from 'vitest';
import { lainConfigYaml, repoStatuses } from '../src/repo-status.js';

const r = (id: string, uri: string, local: string | null = null) => ({ id, uri, sha: null, local });

describe('repoStatuses', () => {
  const scope = {
    reviewed: [
      { repo: 'orders', commit: 'abc', dirty: false },
      { repo: 'legacy', commit: 'def', dirty: true },
    ],
    unreviewed: ['billing'],
  };

  it('marks a repo indexed when LAIN reviewed its derived id, with commit and dirty flag', () => {
    const { repos } = repoStatuses([r('repo_1', 'https://github.com/acme/orders.git')], scope);
    expect(repos[0]).toMatchObject({
      lainRepoId: 'orders',
      state: 'indexed',
      commit: 'abc',
      dirty: false,
    });
  });

  it('derives the id from the local checkout when there is one', () => {
    const { repos } = repoStatuses(
      [r('repo_1', 'https://github.com/acme/x.git', './checkouts/orders')],
      scope,
    );
    expect(repos[0]).toMatchObject({ lainRepoId: 'orders', state: 'indexed' });
  });

  it('tells a repo LAIN knows but has not reviewed from one it has never heard of', () => {
    const { repos } = repoStatuses(
      [
        r('a', 'https://github.com/acme/billing.git'),
        r('b', 'https://github.com/acme/mystery.git'),
      ],
      scope,
    );
    expect(repos.map((x) => x.state)).toEqual(['unreviewed', 'not_in_lain']);
    expect(repos[0]).not.toHaveProperty('commit');
  });

  it('lists what LAIN reviewed that the workspace does not configure', () => {
    const { untracked } = repoStatuses([r('a', 'https://github.com/acme/orders.git')], scope);
    expect(untracked).toEqual([{ repo: 'legacy', commit: 'def' }]);
  });

  it('no configured repos: everything LAIN has is untracked; nothing reviewed: nothing untracked', () => {
    expect(repoStatuses([], scope).untracked).toHaveLength(2);
    expect(
      repoStatuses([r('a', 'https://x/y.git')], { reviewed: [], unreviewed: [] }).untracked,
    ).toEqual([]);
  });
});

describe('lainConfigYaml', () => {
  it('uses the ids LAIN uses (not Parallax internal ids) and the local path', () => {
    const yaml = lainConfigYaml('ws_1', [
      r('repo_internal', 'https://github.com/acme/orders.git', '/srv/orders'),
    ]);
    expect(yaml).toContain('data_dir: /var/parallax/lain-data/ws_1');
    expect(yaml).toContain('  - id: orders');
    expect(yaml).toContain('source: { type: workspace_dir, path: /srv/orders }');
    expect(yaml).toContain('  - name: orders\n    repo: orders');
    expect(yaml).not.toContain('repo_internal');
  });

  it('leaves a repo with no checkout commented out, with what to do', () => {
    const yaml = lainConfigYaml('ws_1', [r('a', 'https://github.com/acme/billing.git')]);
    expect(yaml).toContain(
      '# billing: clone https://github.com/acme/billing.git and set its local path to index it',
    );
    expect(yaml).not.toMatch(/^ {2}- id: billing/m);
    expect(yaml).not.toMatch(/- name: billing/);
  });
});
