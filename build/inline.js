/* build/inline.js — produce a single self-contained offroaders.html
 * with all CSS and JS inlined, so the game runs from one downloaded file. */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

let html = read("index.html");

// NOTE: replacements are passed as FUNCTIONS, not strings. A string replacement
// would interpret `$$`, `$&`, `$1`, etc. in the inlined code as special patterns
// (e.g. `$$` -> `$`), corrupting the source. A function replacement is literal.

// inline the stylesheet
const css = read("css/style.css");
html = html.replace(
  /<link rel="stylesheet" href="css\/style\.css(?:\?[^"]*)?"\s*\/?>/,
  () => `<style>\n${css}\n</style>`
);

// inline the scripts, preserving order (tolerate ?v= cache-busting queries)
["js/tracks.js", "js/vehicles.js", "js/characters.js", "js/circuits.js", "js/career.js", "js/input.js", "js/game.js", "js/gamepro.js", "js/app.js"].forEach((src) => {
  const code = read(src);
  const tag = new RegExp(`<script src="${src.replace(/\//g, "\\/")}(?:\\?[^"]*)?"><\\/script>`);
  html = html.replace(tag, () => `<script>\n${code}\n</script>`);
});

// sanity: make sure nothing was left un-inlined
if (/<link rel="stylesheet"|<script src="js\//.test(html)) {
  console.error("ERROR: some assets were not inlined.");
  process.exit(1);
}

fs.writeFileSync(path.join(root, "offroaders.html"), html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`Built offroaders.html (${kb} KB, single self-contained file)`);
