// Content script — runs on x.com pages.
// Utility files (loaded before this one in the manifest) register themselves on
// window.__ufxUtilities so each stays independently toggleable.

async function main() {
  const utilities = window.__ufxUtilities ?? [];
  const { enabled = {} } = await chrome.storage.sync.get("enabled");
  for (const utility of utilities) {
    if (enabled[utility.id] === false) continue;
    try {
      await utility.run();
    } catch (error) {
      console.error(`[UtilitiesForX] ${utility.id} failed`, error);
    }
  }
}

main();
