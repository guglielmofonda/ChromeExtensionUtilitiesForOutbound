const test = require("node:test");
const assert = require("node:assert/strict");
const UfxTemplates = require("../src/template-lib.js");

test("infers an explicitly linked company handle", () => {
  assert.deepEqual(
    UfxTemplates.inferCompanyFromBio("Co-founder & CEO @WorkOS. Building the modern identity layer."),
    { company: "WorkOS", source: "bio-mention", confidence: "high" }
  );
  assert.deepEqual(
    UfxTemplates.inferCompanyFromBio(
      "creator of @italianbldrs 18+ side projects and 1 startup exit. more soon."
    ),
    { company: "italianbldrs", source: "bio-mention", confidence: "high" }
  );
});

test("infers a proper company name after a founder role", () => {
  assert.deepEqual(
    UfxTemplates.inferCompanyFromBio("Founder of Acme Labs. Angel investor."),
    { company: "Acme Labs", source: "bio-role", confidence: "high" }
  );
  assert.deepEqual(
    UfxTemplates.inferCompanyFromBio("Founder of xAI."),
    { company: "xAI", source: "bio-role", confidence: "high" }
  );
});

test("infers a proper-name company after building", () => {
  assert.deepEqual(
    UfxTemplates.inferCompanyFromBio("Building Modal. Previously at Example."),
    { company: "Modal", source: "bio-building", confidence: "medium" }
  );
});

test("does not turn a generic bio into a company", () => {
  assert.equal(
    UfxTemplates.inferCompanyFromBio("Bike rides for builders & founders in San Francisco 🚲"),
    null
  );
  assert.equal(UfxTemplates.inferCompanyFromBio("Building AI tools for developers."), null);
});

test("does not guess when the bio names conflicting companies", () => {
  assert.equal(
    UfxTemplates.inferCompanyFromBio("Founder of Acme Labs. Building Other Co."),
    null
  );
  assert.equal(UfxTemplates.inferCompanyFromBio("Founder @Acme and CEO @Other"), null);
});

test("company suggestions replace the manual fallback", () => {
  assert.deepEqual(
    UfxTemplates.substitute("latest with {{company}}?", { company: "Acme Labs" }),
    { text: "latest with Acme Labs?", missing: [], placeholders: [] }
  );
  assert.deepEqual(
    UfxTemplates.substitute("latest with {{company}}?", {}),
    { text: "latest with [company]?", missing: [], placeholders: ["[company]"] }
  );
});
