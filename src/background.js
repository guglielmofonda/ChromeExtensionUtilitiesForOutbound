// Background service worker.
// Toolbar click opens the full-page template manager; install/update seeds templates.

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

const PROFILE_HTML_REQUEST = "ufx:profile-html";
const PROFILE_PAGE_BIO_REQUEST = "ufx:profile-page-bio";
const PROFILE_TAB_TIMEOUT = 10_000;
const PROFILE_TAB_RETRY_DELAY = 200;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readPublicProfileBio(handle) {
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle || "")) {
    return { ok: false, error: "invalid-handle" };
  }

  let profileTab;
  try {
    // X marks profile HTML as Cross-Origin-Resource-Policy: same-origin. In
    // live Chromium testing, service-worker fetches could receive status 200
    // and then stall while reading the body. A temporary inactive top-level
    // navigation lets its x.com content script return only the public bio.
    profileTab = await chrome.tabs.create({
      active: false,
      url: `https://x.com/${handle}?ufx_profile_lookup=1`,
    });

    const deadline = Date.now() + PROFILE_TAB_TIMEOUT;
    while (Date.now() < deadline) {
      try {
        const response = await chrome.tabs.sendMessage(profileTab.id, {
          type: PROFILE_PAGE_BIO_REQUEST,
          handle,
        });
        if (response?.ok && response.bio) {
          return { ok: true, bio: response.bio, source: "temporary profile tab" };
        }
        if (response?.error && response.error !== "profile-not-ready") {
          return { ok: false, error: response.error };
        }
      } catch {
        // The content script is not installed until document_idle. Retry only
        // this one tab for a bounded period; never iterate over recipients.
      }
      await delay(PROFILE_TAB_RETRY_DELAY);
    }
    return { ok: false, error: "profile-tab-timeout" };
  } catch {
    return { ok: false, error: "profile-tab-error" };
  } finally {
    if (profileTab?.id != null) {
      await chrome.tabs.remove(profileTab.id).catch(() => {});
    }
  }
}

// Accept only a validated handle from an x.com content script, never an
// arbitrary URL. The temporary tab transport reads one profile per manual
// template invocation and always closes the tab it created.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== PROFILE_HTML_REQUEST) return undefined;
  if (!sender.url?.startsWith("https://x.com/")) {
    sendResponse({ ok: false, error: "invalid-sender" });
    return false;
  }
  readPublicProfileBio(message.handle).then(sendResponse);
  return true;
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
