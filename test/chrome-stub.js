// Test-only stub of the chrome.* APIs the options page touches.
window.__stubStore = {
  dmTemplates: {
    version: 1,
    templates: [
      { id: "starter-latest-company", name: "Latest + company", body: "hey {{first_name}}, what is the latest with {{company}}? are you a solo founder?", shortcut: { code: "Digit1", alt: true, ctrl: false, meta: false, shift: false }, createdAt: 1, updatedAt: 1 },
      { id: "starter-working-on", name: "What are you working on", body: "hey {{first_name}}, what are you working on these days? are you a solo founder?", shortcut: { code: "Digit2", alt: true, ctrl: false, meta: false, shift: false }, createdAt: 2, updatedAt: 2 },
    ],
  },
};
window.chrome = {
  storage: {
    sync: {
      get: async (key) => ({ [key]: window.__stubStore[key] }),
      set: async (obj) => { Object.assign(window.__stubStore, obj); },
    },
    onChanged: { addListener() {} },
  },
};
