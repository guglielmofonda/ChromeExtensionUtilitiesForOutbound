// Content script — runs on x.com pages.
// Utilities are registered here so each one stays independently toggleable.

const utilities = [
  // { id: "example", label: "Example", run() {} },
];

async function main() {
  const { enabled = {} } = await chrome.storage.sync.get("enabled");
  for (const utility of utilities) {
    if (enabled[utility.id] === false) continue;
    try {
      utility.run();
    } catch (error) {
      console.error(`[UtilitiesForX] ${utility.id} failed`, error);
    }
  }
}

main();
