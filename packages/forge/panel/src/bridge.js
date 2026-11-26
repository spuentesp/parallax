// The only place the panel talks to Forge.
//
// In Jira the panel runs inside a sandboxed iframe and reaches the server through
// @forge/bridge. That library throws as soon as it is imported outside Jira, so it is loaded
// on demand and never in mock mode.
//
// For development in a normal browser, opening the page with ?mock=<name> serves a saved real
// response from panel/fixtures instead (development builds only).

const MOCK = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('mock') : null;
const fixtures = import.meta.env.DEV ? import.meta.glob('../fixtures/*.json') : {};

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const isMock = () => MOCK !== null;

// Ask the resolver for the review of the issue this panel is open on.
export async function loadReview() {
  if (!MOCK) {
    const { invoke } = await import('@forge/bridge');
    return invoke('review');
  }
  await pause(500);
  if (MOCK === 'error') return { error: 'Parallax could not be reached (mock).' };
  const load = fixtures[`../fixtures/${MOCK}.json`];
  if (!load) return { error: `No fixture named '${MOCK}'.` };
  return (await load()).default;
}

// Open a link in a new tab. Inside Jira a sandboxed iframe must ask the host to do it.
export async function openUrl(url) {
  if (MOCK) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const { router } = await import('@forge/bridge');
  await router.open(url);
}

// Pick up Jira's light or dark theme so the panel matches the page around it.
export async function enableTheme() {
  if (MOCK) return;
  const { view } = await import('@forge/bridge');
  await view.theme.enable();
}
