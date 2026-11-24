// Server side of the Jira issue panel.
//
// The panel (a Custom UI app in static/panel) asks this resolver for the review of the issue it
// is open on. The resolver reads the issue as the person looking at it, so Jira's own
// permissions apply, then reuses the same ticketReview the Rovo agent and the MCP tools use.
import api, { route } from '@forge/api';
import * as resolverModule from '@forge/resolver';
import { ticketReview } from './index.js';
import { pickClass } from './interop.js';
import { ticketText } from './jira.js';

// @forge/resolver is CommonJS: see interop.js for why a plain default import is not enough.
const Resolver = pickClass(resolverModule);
const resolver = new Resolver();

resolver.define('review', async ({ context }) => {
  const key = context.extension?.issue?.key;
  if (!key) return { error: 'This panel only works on a Jira issue.' };

  const asUser = api.asUser();
  const [issueRes, linksRes] = await Promise.all([
    asUser.requestJira(route`/rest/api/3/issue/${key}?fields=summary,description,comment`),
    asUser.requestJira(route`/rest/api/3/issue/${key}/remotelink`),
  ]);
  if (!issueRes.ok) return { error: `Could not read ${key} (HTTP ${issueRes.status}).` };

  const issue = await issueRes.json();
  // Remote links are a bonus (they carry pull requests linked from other tools); the issue
  // text alone is enough if they cannot be read.
  const links = linksRes.ok ? await linksRes.json() : [];

  const review = await ticketReview({ text: ticketText(issue, links) });
  return review.error ? review : { issueKey: key, ...review };
});

export const handler = resolver.getDefinitions();
