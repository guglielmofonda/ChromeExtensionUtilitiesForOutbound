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

test("recognizes LinkedIn's connection invitation note surface", () => {
  assert.equal(
    UfxLinkedIn.isConnectionNoteContext({
      dialogText: "Add a note to your invitation",
    }),
    true
  );
  assert.equal(
    UfxLinkedIn.isConnectionNoteContext({
      placeholder: "Ex: We know each other from...",
    }),
    true
  );
  assert.equal(
    UfxLinkedIn.isConnectionNoteContext({
      dialogText: "Ex: We know each other from...",
    }),
    true
  );
  assert.equal(
    UfxLinkedIn.isConnectionNoteContext({
      placeholder: "Add a note to your invitation",
    }),
    true
  );
  assert.equal(
    UfxLinkedIn.isConnectionNoteContext({
      dialogText: "Create a post",
      placeholder: "What do you want to talk about?",
    }),
    false
  );
});

test("reads the connection-note limit from LinkedIn's counter", () => {
  assert.equal(UfxLinkedIn.connectionNoteCharacterLimit("0/300"), 300);
  assert.equal(UfxLinkedIn.connectionNoteCharacterLimit("Personal note 12 / 500"), 500);
  assert.equal(UfxLinkedIn.connectionNoteCharacterLimit("No counter"), 300);
});

test("keeps connection notes within LinkedIn's character limit", () => {
  assert.equal(
    UfxLinkedIn.exceedsCharacterLimit({
      currentText: "Already drafted",
      insertedText: "x".repeat(285),
      maxLength: 300,
    }),
    false
  );
  assert.equal(
    UfxLinkedIn.exceedsCharacterLimit({
      currentText: "Already drafted",
      insertedText: "x".repeat(286),
      maxLength: 300,
    }),
    true
  );
});

test("resolves a connection-note recipient from the open member profile", () => {
  assert.deepEqual(
    UfxLinkedIn.recipientFromProfile({
      nameCandidates: ["Jesse Tabak · 2nd"],
      profileHrefs: ["https://www.linkedin.com/in/jesse-tabak/"],
    }),
    {
      fullName: "Jesse Tabak",
      firstName: "Jesse",
      handle: "jesse-tabak",
      reason: "",
    }
  );
});

test("falls back to the open LinkedIn profile title for connection notes", () => {
  assert.deepEqual(
    UfxLinkedIn.recipientFromProfile({
      profileHrefs: ["https://www.linkedin.com/in/jesse-tabak/"],
      titleCandidates: ["Jesse Tabak - freight & software | LinkedIn"],
    }),
    {
      fullName: "Jesse Tabak",
      firstName: "Jesse",
      handle: "jesse-tabak",
      reason: "",
    }
  );
  assert.equal(UfxLinkedIn.profileNameFromTitle("LinkedIn Login | LinkedIn"), "");
});

test("ignores LinkedIn unread counts and numeric UI badges when resolving a profile name", () => {
  assert.equal(
    UfxLinkedIn.profileNameFromTitle("(1) Harrison Engel | LinkedIn"),
    "Harrison Engel"
  );
  assert.equal(
    UfxLinkedIn.profileNameFromTitle("(12+) Shirley Jiang - Founder | LinkedIn"),
    "Shirley Jiang"
  );
  assert.equal(UfxLinkedIn.cleanHeaderName("1"), "");
  assert.equal(UfxLinkedIn.cleanHeaderName("3rd"), "");
  assert.equal(UfxLinkedIn.cleanHeaderName("1\nHarrison Engel"), "Harrison Engel");
  assert.deepEqual(
    UfxLinkedIn.recipientFromProfile({
      nameCandidates: ["1"],
      profileHrefs: ["https://www.linkedin.com/in/harrison-engel-41018a55/"],
      titleCandidates: ["(1) Harrison Engel | LinkedIn"],
    }),
    {
      fullName: "Harrison Engel",
      firstName: "Harrison",
      handle: "harrison-engel-41018a55",
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

test("prefers LinkedIn's explicit current company over a generic profile headline", () => {
  assert.deepEqual(
    UfxLinkedIn.companyFromProfileSignals({
      currentCompanyCandidates: [
        "Current company: Sedona. Click to skip to experience card",
        "Sedona",
        "Sedona logo",
      ],
      headlines: ["freight & software"],
    }),
    { company: "Sedona", source: "profile-current-company", confidence: "high" }
  );
});

test("keeps profile company resolution conservative", () => {
  assert.equal(
    UfxLinkedIn.companyFromProfileSignals({
      currentCompanyCandidates: ["Acme", "Other Co"],
      headlines: ["Founder at Acme"],
    }),
    null
  );
  assert.deepEqual(
    UfxLinkedIn.companyFromProfileSignals({ headlines: ["Founder at Acme Labs"] }),
    { company: "Acme Labs", source: "bio-role", confidence: "high" }
  );
});

test("resolves a current company from the open profile's Experience entry", () => {
  assert.deepEqual(
    UfxLinkedIn.companyFromProfileSignals({
      experienceCompanyCandidates: ["Sedona logo", "Sedona"],
      headlines: ["freight & software"],
    }),
    { company: "Sedona", source: "profile-experience", confidence: "high" }
  );
});

test("uses LinkedIn's profile-title company without treating a generic headline as one", () => {
  assert.equal(
    UfxLinkedIn.profileCompanyFromTitle("Jesse Tabak - freight & software | LinkedIn"),
    ""
  );
  assert.deepEqual(
    UfxLinkedIn.companyFromProfileSignals({
      titleCandidates: ["Jesse Tabak - Sedona | LinkedIn"],
      headlines: ["freight & software"],
    }),
    { company: "Sedona", source: "profile-title", confidence: "medium" }
  );
});
