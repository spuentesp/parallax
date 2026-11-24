// Turns a Jira issue into the plain text Parallax reads.
//
// Jira stores rich text as Atlassian Document Format (ADF), a JSON tree. A pull request link
// can appear in it three ways, and all three must be seen:
//   - plain text:         "Pull request: https://github.com/o/r/pull/1"
//   - a link mark:        text "the PR" with marks [{ type: 'link', attrs: { href } }]
//   - a smart link card:  { type: 'inlineCard', attrs: { url } }
// Pure functions, no network.

const BLOCKS = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'listItem',
  'tableRow',
  'rule',
  'panel',
]);

// The plain text of an ADF node, with links written out so a text search finds them.
export function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;

  switch (node.type) {
    case 'text': {
      const href = (node.marks ?? []).find((m) => m.type === 'link')?.attrs?.href;
      // Write the address out when the visible words are not already the address.
      return href && !String(node.text).includes(href)
        ? `${node.text} (${href})`
        : (node.text ?? '');
    }
    case 'inlineCard':
    case 'blockCard':
    case 'embedCard':
      return node.attrs?.url ?? '';
    case 'mention':
      return node.attrs?.text ?? '';
    case 'emoji':
      return node.attrs?.text ?? node.attrs?.shortName ?? '';
    case 'status':
      return node.attrs?.text ?? '';
    case 'hardBreak':
      return '\n';
    case 'media':
    case 'mediaSingle':
    case 'mediaGroup':
      return '';
    default:
      break;
  }

  const inner = (node.content ?? []).map(adfToText).join(node.type === 'doc' ? '' : '');
  return BLOCKS.has(node.type) ? `${inner}\n` : inner;
}

// Everything worth reading from an issue, most important first so a length cap cuts the
// least useful part: summary, description, linked pull requests, then the latest comments.
//   issue       : the JSON of GET /rest/api/3/issue/{key}?fields=summary,description,comment
//   remoteLinks : the JSON of GET /rest/api/3/issue/{key}/remotelink (optional)
export function ticketText(issue, remoteLinks = [], { maxComments = 10, maxChars = 8000 } = {}) {
  const f = issue?.fields ?? {};
  const parts = [f.summary ?? '', adfToText(f.description)];

  for (const l of remoteLinks ?? []) {
    const url = l?.object?.url;
    if (url) parts.push(`Linked: ${url}`);
  }

  const comments = (f.comment?.comments ?? []).slice(-maxComments);
  for (const c of comments) parts.push(adfToText(c.body));

  return parts
    .map((p) =>
      String(p)
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    )
    .filter(Boolean)
    .join('\n\n')
    .slice(0, maxChars);
}
