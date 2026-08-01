// Background service worker.
// Toolbar click opens the full-page template manager; install/update seeds templates.

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

const STARTER_TEMPLATES = [
  {
    id: "starter-latest-company",
    name: "Latest + company",
    body: "hey {{first_name}}, what is the latest with {{company}}? are you a solo founder?",
    shortcut: { code: "Digit1", alt: true, ctrl: false, meta: false, shift: false },
  },
  {
    id: "starter-working-on",
    name: "What are you working on",
    body: "hey {{first_name}}, what are you working on these days? are you a solo founder?",
    shortcut: { code: "Digit2", alt: true, ctrl: false, meta: false, shift: false },
  },
];

// Bodies of the v1 placeholder starters, so an update can tell "still the demo
// content, safe to replace" apart from "user already customized — hands off".
const V1_STARTER_BODIES = new Set([
  "Hey {{first_name}}! Loved what you're building — would be great to connect.",
  "Hey {{first_name}}! We're hosting a small dinner with a few founders next week — would love to have you there. Want me to send details?",
]);

function seededStore() {
  const now = Date.now();
  return {
    version: 1,
    templates: STARTER_TEMPLATES.map((t) => ({ ...t, createdAt: now, updatedAt: now })),
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  const { dmTemplates } = await chrome.storage.sync.get("dmTemplates");
  const untouchedV1 =
    dmTemplates?.templates?.length > 0 &&
    dmTemplates.templates.every((t) => V1_STARTER_BODIES.has(t.body));
  if (!dmTemplates || untouchedV1) {
    await chrome.storage.sync.set({ dmTemplates: seededStore() });
  }
});
