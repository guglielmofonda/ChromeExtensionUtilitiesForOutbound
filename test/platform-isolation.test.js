const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const manifest = JSON.parse(fs.readFileSync(require.resolve("../manifest.json"), "utf8"));

test("keeps the existing X content-script stack unchanged", () => {
  const x = manifest.content_scripts.find((entry) => entry.matches.includes("https://x.com/*"));
  assert.deepEqual(x, {
    matches: ["https://x.com/*"],
    js: ["src/template-lib.js", "src/dm-templates.js", "src/content.js"],
    css: ["src/content.css"],
    run_at: "document_idle",
  });
});

test("loads LinkedIn through its own adapter", () => {
  assert.deepEqual(manifest.host_permissions, [
    "https://x.com/*",
    "https://www.linkedin.com/*",
  ]);
  const linkedin = manifest.content_scripts.find(
    (entry) => entry.matches.includes("https://www.linkedin.com/*")
  );
  assert.deepEqual(linkedin, {
    matches: ["https://www.linkedin.com/*"],
    js: [
      "src/template-lib.js",
      "src/linkedin-lib.js",
      "src/linkedin-dm-templates.js",
      "src/content.js",
    ],
    css: ["src/content.css"],
    run_at: "document_idle",
  });
  assert.ok(!linkedin.js.includes("src/dm-templates.js"));
});

test("LinkedIn adapter has no network, profile-tab, or send action", () => {
  const source = fs.readFileSync(require.resolve("../src/linkedin-dm-templates.js"), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /chrome\.tabs|chrome\.runtime\.sendMessage/);
  assert.doesNotMatch(source, /\.click\s*\(|requestSubmit\s*\(|\.submit\s*\(/);
});

test("LinkedIn connection-note harness uses the isolated adapter and cannot auto-send", () => {
  const harness = fs.readFileSync(
    require.resolve("./linkedin-connection-harness.html"),
    "utf8"
  );
  assert.match(harness, /Add a note to your invitation/);
  assert.match(harness, /src\/linkedin-dm-templates\.js/);
  assert.match(harness, /maxlength="300"/);
  assert.doesNotMatch(harness, /sendButton\.click\s*\(/);
});
