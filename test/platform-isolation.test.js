const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const manifest = JSON.parse(fs.readFileSync(require.resolve("../manifest.json"), "utf8"));

test("identifies the current unpacked extension build", () => {
  assert.equal(manifest.version, "0.4.5");
});

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
  assert.match(source, /event\.composedPath/);
  assert.match(source, /EDITABLE_COMPOSER_SELECTOR/);
});

test("LinkedIn company lookup includes the full profile card and its affiliation rows", () => {
  const source = fs.readFileSync(require.resolve("../src/linkedin-dm-templates.js"), "utf8");
  const fullCardLookup = source.indexOf('main [data-view-name="profile-card"]');
  const leftPanelFallback = source.indexOf('leftPanel?.closest("section, .artdeco-card")');

  assert.ok(fullCardLookup >= 0);
  assert.ok(leftPanelFallback > fullCardLookup);
  assert.match(source, /PROFILE_EDUCATION_SELECTORS/);
  assert.match(source, /previousElementSibling/);
});

test("LinkedIn connection-note harness uses the isolated adapter and cannot auto-send", () => {
  const harness = fs.readFileSync(
    require.resolve("./linkedin-connection-harness.html"),
    "utf8"
  );
  assert.match(harness, /Add a note to your invitation/);
  assert.match(harness, /src\/linkedin-dm-templates\.js/);
  assert.match(harness, /aria-modal="true"/);
  assert.match(harness, /contenteditable="plaintext-only"/);
  assert.match(harness, /data-placeholder="Ex: We know each other from\.\.\."/);
  assert.match(harness, /focused-fallback/);
  assert.match(harness, /data-view-name="profile-card"/);
  assert.match(harness, /Jesse Tabak - freight &amp; software \| LinkedIn/);
  assert.match(harness, /profile-affiliation/);
  assert.match(harness, /linkedin\.com\/school\/northwestern-university/);
  assert.match(harness, /Sedona logo/);
  assert.match(harness, /freight &amp; software/);
  assert.doesNotMatch(harness, /linkedin\.com\/company\/sedona/);
  assert.doesNotMatch(harness, /current company/i);
  assert.doesNotMatch(harness, /<h2>Experience<\/h2>/);
  assert.doesNotMatch(harness, /sendButton\.click\s*\(/);
});
