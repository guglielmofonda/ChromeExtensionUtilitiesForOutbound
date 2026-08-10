const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadBackground({ tabs: tabOverrides = {}, DateImpl = Date, setTimeoutImpl = setTimeout } = {}) {
  let messageListener = null;
  const calls = { create: [], sendMessage: [], remove: [] };
  const tabs = {
    async create(properties) {
      calls.create.push(properties);
      return { id: 42 };
    },
    async sendMessage(tabId, message) {
      calls.sendMessage.push({ tabId, message });
      return { ok: true, bio: "Founder @Acme" };
    },
    async remove(tabId) {
      calls.remove.push(tabId);
    },
    ...tabOverrides,
  };
  const chrome = {
    action: { onClicked: { addListener() {} } },
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: { addListener(listener) { messageListener = listener; } },
      openOptionsPage() {},
    },
    storage: { sync: { get: async () => ({}), set: async () => {} } },
    tabs,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/background.js"), "utf8"), {
    chrome,
    Date: DateImpl,
    setTimeout: setTimeoutImpl,
  });
  return { calls, listener: messageListener };
}

function send(listener, message, sender = { url: "https://x.com/i/chat/111-222" }) {
  return new Promise((resolve) => {
    const asyncResponse = listener(message, sender, (response) => {
      resolve(JSON.parse(JSON.stringify(response)));
    });
    assert.equal(asyncResponse, true);
  });
}

test("background profile lookup opens one inactive validated profile tab and closes it", async () => {
  const { calls, listener } = loadBackground();
  const response = await send(listener, { type: "ufx:profile-html", handle: "janedoe" });

  assert.deepEqual(response, {
    ok: true,
    bio: "Founder @Acme",
    source: "temporary profile tab",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls.create)), [{
    active: false,
    url: "https://x.com/janedoe?ufx_profile_lookup=1",
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.sendMessage)), [{
    tabId: 42,
    message: { type: "ufx:profile-page-bio", handle: "janedoe" },
  }]);
  assert.deepEqual(calls.remove, [42]);
});

test("background profile lookup rejects arbitrary paths and non-X senders", async () => {
  const { calls, listener } = loadBackground();

  assert.deepEqual(
    await send(listener, { type: "ufx:profile-html", handle: "../settings" }),
    { ok: false, error: "invalid-handle" }
  );

  const invalidSender = await new Promise((resolve) => {
    const asyncResponse = listener(
      { type: "ufx:profile-html", handle: "janedoe" },
      { url: "https://example.com/" },
      (response) => resolve(JSON.parse(JSON.stringify(response)))
    );
    assert.equal(asyncResponse, false);
  });
  assert.deepEqual(invalidSender, { ok: false, error: "invalid-sender" });
  assert.deepEqual(calls.create, []);
});

test("background profile lookup reports missing metadata and still closes its tab", async () => {
  const { calls, listener } = loadBackground({
    tabs: {
      async sendMessage() {
        return { ok: false, error: "profile-no-bio-metadata" };
      },
    },
  });

  assert.deepEqual(
    await send(listener, { type: "ufx:profile-html", handle: "janedoe" }),
    { ok: false, error: "profile-no-bio-metadata" }
  );
  assert.deepEqual(calls.remove, [42]);
});

test("background profile lookup times out without leaking browser error details", async () => {
  let now = 0;
  const { calls, listener } = loadBackground({
    DateImpl: { now: () => { now += 6_000; return now; } },
    setTimeoutImpl: (callback) => { callback(); return 1; },
    tabs: {
      async sendMessage() {
        throw new Error("private browser detail");
      },
    },
  });

  assert.deepEqual(
    await send(listener, { type: "ufx:profile-html", handle: "janedoe" }),
    { ok: false, error: "profile-tab-timeout" }
  );
  assert.deepEqual(calls.remove, [42]);
});
