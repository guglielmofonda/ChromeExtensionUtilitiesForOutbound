const test = require("node:test");
const assert = require("node:assert/strict");
const UfxLinkedIn = require("../src/linkedin-lib.js");

test("accepts only canonical LinkedIn member profile links", () => {
  assert.equal(UfxLinkedIn.profileSlugFromHref("/in/jane-doe/?miniProfileUrn=123"), "jane-doe");
  assert.equal(
    UfxLinkedIn.profileSlugFromHref("https://linkedin.com/in/Jane_Doe-42"),
    "Jane_Doe-42"
  );
  assert.equal(UfxLinkedIn.profileSlugFromHref("https://evil.example/in/jane-doe"), "");
  assert.equal(UfxLinkedIn.profileSlugFromHref("https://www.linkedin.com/company/acme"), "");
  assert.equal(UfxLinkedIn.profileSlugFromHref("/in/../settings"), "");
});

test("resolves a one-to-one recipient and maps the profile slug to handle", () => {
  assert.deepEqual(
    UfxLinkedIn.recipientFromHeader({
      nameCandidates: ["Jane Doe · 1st-degree connection", "Jane Doe"],
      profileHrefs: ["/in/jane-doe/"],
      headerText: "Jane Doe\nFounder & CEO at Acme Labs",
    }),
    {
      fullName: "Jane Doe",
      firstName: "Jane",
      handle: "jane-doe",
      reason: "",
    }
  );
});

test("supports overlay headers that do not expose a profile link", () => {
  assert.deepEqual(
    UfxLinkedIn.recipientFromHeader({
      nameCandidates: ["Open the conversation details for DR. JANE DOE\nActive now"],
      headerText: "DR. JANE DOE\nActive now",
    }),
    {
      fullName: "DR. JANE DOE",
      firstName: "Jane",
      handle: "",
      reason: "",
    }
  );
});

test("fails closed for group conversations", () => {
  assert.match(
    UfxLinkedIn.recipientFromHeader({
      nameCandidates: ["Jane Doe", "John Smith"],
      profileHrefs: ["/in/jane-doe", "/in/john-smith"],
    }).reason,
    /group conversation/
  );
  assert.match(
    UfxLinkedIn.recipientFromHeader({
      nameCandidates: ["Jane Doe and 2 others"],
      headerText: "Jane Doe and 2 others",
    }).reason,
    /group conversation/
  );
});

test("suggests one unambiguous company from visible LinkedIn headlines", () => {
  assert.deepEqual(
    UfxLinkedIn.companyFromHeadlines([
      "Co-founder & CEO at Acme Labs | Building useful software",
    ]),
    { company: "Acme Labs", source: "bio-role", confidence: "high" }
  );
  assert.equal(
    UfxLinkedIn.companyFromHeadlines([
      "Founder of Acme Labs",
      "Founder of Other Co",
    ]),
    null
  );
  assert.equal(UfxLinkedIn.companyFromHeadlines(["Builder and investor"]), null);
});
