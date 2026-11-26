// Finding the stored analysis of a pull request. The app first asks the server for just that
// pull request's rows and opens one full report; against an older server that ignores the filter
// it falls back to opening the newest reports. Only the network (and Forge's own package) is faked.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.mock('@forge/api', () => ({
  default: {},
  assumeTrustedRoute: (x) => x,
  fetch: (...args) => fetchMock(...args),
}));

const { findPrAssessment } = await import('../src/index.js');

const ref = { owner: 'NVIDIA', repo: 'OpenShell', number: 5052 };
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const full = (id, pr, status = 'READY') => ({ id, status, manifest: { pr } });
const pr = (number) => ({ owner: 'NVIDIA', repo: 'OpenShell', number });

// A fake Parallax server. `knowsFilter` decides whether it understands ?pr=.
function server(rows, { knowsFilter }) {
  const opened = [];
  fetchMock.mockImplementation(async (url) => {
    const u = new URL(url);
    if (u.pathname === '/api/assessments') {
      const wanted = u.searchParams.get('pr');
      const light = rows.map((r) =>
        knowsFilter
          ? { id: r.id, status: r.status, createdAt: r.createdAt, pr: r.manifest.pr }
          : { id: r.id, status: r.status, createdAt: r.createdAt },
      );
      const keep =
        knowsFilter && wanted
          ? light.filter((a) => `${a.pr?.owner}/${a.pr?.repo}#${a.pr?.number}` === wanted)
          : light;
      return ok({ assessments: keep });
    }
    const id = u.pathname.split('/').pop();
    opened.push(id);
    return ok({ assessment: rows.find((r) => r.id === id) });
  });
  return opened;
}

beforeEach(() => {
  process.env.PARALLAX_TOKEN = 't';
  fetchMock.mockReset();
});

describe('findPrAssessment against a server that knows the pr filter', () => {
  it('opens exactly one full report, the finished one for that pull request', async () => {
    const rows = [
      { ...full('a1', pr(5052), 'PARTIAL'), createdAt: 1 },
      { ...full('a2', pr(13812)), createdAt: 2 },
      { ...full('a3', pr(7)), createdAt: 3 },
    ];
    const opened = server(rows, { knowsFilter: true });
    const found = await findPrAssessment(ref);
    expect(found.assessment.id).toBe('a1');
    expect(opened).toEqual(['a1']);
    expect(String(fetchMock.mock.calls[0][0])).toContain('pr=NVIDIA%2FOpenShell%235052');
  });

  it('prefers the newest finished report over a newer failed one', async () => {
    const rows = [
      { ...full('old', pr(5052), 'READY'), createdAt: 1 },
      { ...full('bad', pr(5052), 'FAILED'), createdAt: 9 },
    ];
    server(rows, { knowsFilter: true });
    expect((await findPrAssessment(ref)).assessment.id).toBe('old');
  });

  it('says so when the only attempt failed, or is still running', async () => {
    server([{ ...full('bad', pr(5052), 'FAILED'), createdAt: 1 }], { knowsFilter: true });
    expect(await findPrAssessment(ref)).toEqual({ failed: true });
    server([{ ...full('run', pr(5052), 'ANALYZING'), createdAt: 1 }], { knowsFilter: true });
    expect(await findPrAssessment(ref)).toEqual({ running: 'ANALYZING' });
  });

  it('returns nothing, and opens nothing, for a pull request that was never assessed', async () => {
    const opened = server([{ ...full('a2', pr(13812)), createdAt: 2 }], { knowsFilter: true });
    expect(await findPrAssessment(ref)).toEqual({});
    expect(opened).toEqual([]);
  });
});

describe('findPrAssessment against an older server that ignores the filter', () => {
  it('falls back to opening the newest reports and still finds the right one', async () => {
    const rows = [
      { ...full('a1', pr(5052), 'PARTIAL'), createdAt: 1 },
      { ...full('a2', pr(13812)), createdAt: 2 },
    ];
    const opened = server(rows, { knowsFilter: false });
    const found = await findPrAssessment(ref);
    expect(found.assessment.id).toBe('a1');
    expect(opened.sort()).toEqual(['a1', 'a2']);
  });

  it('reports an error from the server instead of pretending nothing was found', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    expect((await findPrAssessment(ref)).error).toMatch(/HTTP 503/);
  });
});
