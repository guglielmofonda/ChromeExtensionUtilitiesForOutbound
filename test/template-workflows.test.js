const test = require("node:test");
const assert = require("node:assert/strict");
const UfxTemplates = require("../src/template-lib.js");

test("old templates remain available on both platforms", () => {
  assert.deepEqual(UfxTemplates.normalizePlatforms(undefined), ["x", "linkedin"]);
  assert.equal(UfxTemplates.templateSupportsPlatform({}, "x"), true);
  assert.equal(UfxTemplates.templateSupportsPlatform({}, "linkedin"), true);
});

test("platform targeting is conservative and never produces an empty target", () => {
  assert.deepEqual(UfxTemplates.normalizePlatforms(["linkedin", "unknown"]), ["linkedin"]);
  assert.deepEqual(UfxTemplates.normalizePlatforms([]), ["x", "linkedin"]);
  assert.equal(
    UfxTemplates.templateSupportsPlatform({ platforms: ["linkedin"] }, "x"),
    false
  );
});

test("shortcut conflicts only matter where platform targets overlap", () => {
  const xOnly = { platforms: ["x"] };
  const linkedinOnly = { platforms: ["linkedin"] };
  const both = { platforms: ["x", "linkedin"] };

  assert.equal(UfxTemplates.templatesSharePlatform(xOnly, linkedinOnly), false);
  assert.equal(UfxTemplates.templatesSharePlatform(xOnly, both), true);
  assert.equal(UfxTemplates.templatesSharePlatform(linkedinOnly, both), true);
});

test("template diagnostics identify variables, review points, and links", () => {
  assert.deepEqual(
    UfxTemplates.analyzeTemplate(
      "hey {{first_name}}, how is {{company}}? see https://example.com {{typo}}"
    ),
    {
      variables: ["first_name", "company"],
      unknown: ["typo"],
      usesCompany: true,
      hasLink: true,
      characterCount: 72,
    }
  );
});

test("single braces remain literal unless they name a supported variable", () => {
  assert.deepEqual(UfxTemplates.analyzeTemplate("keep {word}, use {first_name}"), {
    variables: ["first_name"],
    unknown: [],
    usesCompany: false,
    hasLink: false,
    characterCount: 29,
  });
});
