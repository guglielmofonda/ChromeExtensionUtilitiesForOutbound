// Reuse the production markup so browser QA cannot silently drift from the
// extension options page. Scripts inserted through innerHTML stay inert; load
// the production controller only after the body has been replaced.
(async () => {
  const response = await fetch("../src/options.html");
  if (!response.ok) throw new Error("Could not load the options-page markup.");
  const source = await response.text();
  const parsed = new DOMParser().parseFromString(source, "text/html");
  document.body.replaceChildren(...parsed.body.childNodes);

  const controller = document.createElement("script");
  controller.src = "../src/options.js";
  document.body.appendChild(controller);
})();
