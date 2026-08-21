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
