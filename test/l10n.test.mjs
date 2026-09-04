import fs from 'node:fs';
import { ROOT, ADDON } from './load.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

const SOURCES = ['zotlook.js','epub.js','util.js','bootstrap.js','prefs-pane.js','prefs-pane.xhtml'];
const src = SOURCES.map(f => fs.readFileSync(ADDON+f,'utf8')).join('\n');
const xhtml = fs.readFileSync(ADDON+'prefs-pane.xhtml','utf8');

// Every id the code asks for: menu descriptors, _string(), the pane markup,
// and anything set at runtime through document.l10n.
const used = new Set([
  ...[...src.matchAll(/l10nID:\s*"([^"]+)"/g)].map(m => m[1]),
  ...[...src.matchAll(/_string\(\s*\n?\s*"([^"]+)"/g)].map(m => m[1]),
  ...[...src.matchAll(/_formatString\(\s*\n?\s*"([^"]+)"/g)].map(m => m[1]),
  ...[...src.matchAll(/data-l10n-id="([^"]+)"/g)].map(m => m[1]),
  ...[...src.matchAll(/setAttributes\([^,]+,\s*"([^"]+)"/g)].map(m => m[1]),
  // The pane's row notes are named at the call site and set one level down
  ...[...src.matchAll(/showNote\([^,]+,[^,]+,\s*"([^"]+)"/g)].map(m => m[1]),
  ...[...src.matchAll(/\?\s*"(zotlook-[a-z-]+)"\s*:/g)].map(m => m[1]),
]);
ok(used.size >= 20, `code references ${used.size} strings`);

/** Parses an FTL file into {id: {hasValue, attributes}}. */
function parseFtl(text) {
  const messages = new Map();
  const bad = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const attr = line.match(/^\s+\.([a-zA-Z][\w-]*)\s*=\s*(.*)$/);
    if (attr) {
      if (!current) { bad.push(line); continue; }
      messages.get(current).attributes.add(attr[1]);
      continue;
    }
    const msg = line.match(/^([a-zA-Z][\w-]*)\s*=\s*(.*)$/);
    if (!msg) { bad.push(line); continue; }
    current = msg[1];
    messages.set(current, { hasValue: msg[2].trim() !== '', attributes: new Set() });
  }
  return { messages, bad };
}

const locales = fs.readdirSync(ADDON+'locale');
eq(locales.sort(), ['de-DE','en-US'], 'both locales present');

const parsed = new Map();
for (const loc of locales) {
  const { messages, bad } = parseFtl(fs.readFileSync(`${ADDON}locale/${loc}/zotlook.ftl`,'utf8'));
  parsed.set(loc, messages);
  eq(bad, [], `${loc}: every line is a comment, a message or an attribute`);
  eq([...used].filter(id => !messages.has(id)), [], `${loc}: defines every id the code uses`);
  eq([...messages.keys()].filter(id => !used.has(id)), [], `${loc}: defines nothing unused`);
}
eq([...parsed.get('de-DE').keys()].sort(), [...parsed.get('en-US').keys()].sort(),
   'locales define the same ids');

// ── the trap that produced blank labels, twice ────────────────────────
// Fluent applies a message's value as text content. XUL <button>, <menuitem>
// and <checkbox> render their label attribute and ignore text content, so
// those need the .label attribute form; <label> and <description> do not.
{
  const needsLabel = new Set([
    ...[...xhtml.matchAll(/<(?:button|menuitem|checkbox)\b[^>]*data-l10n-id="([^"]+)"/g)].map(m => m[1]),
    // set at runtime on a button
    'zotlook-prefs-key-unset', 'zotlook-prefs-key-recording',
  ]);
  ok(needsLabel.size >= 6, `${needsLabel.size} ids land on a XUL button or menuitem`);
  for (const loc of locales) {
    const messages = parsed.get(loc);
    const missing = [...needsLabel].filter(id => !messages.get(id)?.attributes.has('label'));
    eq(missing, [], `${loc}: every button and menuitem string uses the .label form`);
  }

  // Conversely, anything read as a value must have one — except the item
  // pane's sidenav button, which Zotero labels by tooltip alone
  const readAsValue = new Set([
    ...[...src.matchAll(/l10nID:\s*"([^"]+)"/g)].map(m => m[1]).filter(id => !/-sidenav$/.test(id)),
    ...[...src.matchAll(/_string\(\s*\n?\s*"([^"]+)"/g)].map(m => m[1]),
  ...[...src.matchAll(/_formatString\(\s*\n?\s*"([^"]+)"/g)].map(m => m[1]),
  ]);
  for (const loc of locales) {
    const messages = parsed.get(loc);
    const missing = [...readAsValue].filter(id => !messages.get(id)?.hasValue);
    eq(missing, [], `${loc}: every string read as a value has one`);
  }
}

const declared = src.match(/L10N_FILE:\s*"([^"]+)"/)[1];
ok(fs.existsSync(`${ADDON}locale/en-US/${declared}`), `L10N_FILE "${declared}" exists on disk`);

// ── preference defaults ───────────────────────────────────────────────
const prefsSrc = fs.readFileSync(ADDON+'prefs.js','utf8');
const declaredPrefs = new Set([...prefsSrc.matchAll(/pref\("([^"]+)"/g)].map(m => m[1]));
const readPrefs = new Set([
  ...[...src.matchAll(/pref:\s*"([^"]+)"/g)].map(m => 'extensions.zotlook.' + m[1]),
  ...[...src.matchAll(/_pref\("([^"]+)"/g)].map(m => 'extensions.zotlook.' + m[1]),
  ...[...src.matchAll(/getPref\("([^"]+)"/g)].map(m => 'extensions.zotlook.' + m[1]),
  ...[...src.matchAll(/preference="([^"]+)"/g)].map(m => m[1]),
]);
eq([...readPrefs].filter(p => !declaredPrefs.has(p)), [], 'every preference the code reads has a default');
eq([...declaredPrefs].filter(p => !readPrefs.has(p)), [], 'no default is declared that nothing reads');
ok([...declaredPrefs].every(p => p.startsWith('extensions.zotlook.')), 'all defaults sit on the plugin branch');

// ── a string asked for must also be fetched ───────────────────────────
// _string(id, fallback) answers from what _loadStrings put in the map, and
// falls back silently to the English default when the id was never fetched.
// That is how the annotations button stayed "Annotations" in a German Zotero:
// the string existed in both locales, the call site was right, and the id was
// missing from the one list that decides what is loaded.
{
  const loaded = new Set([
    ...[...src.matchAll(/LOADED_STRINGS:\s*\[([^\]]+)\]/g)]
      .flatMap(m => [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1])),
    ...[...src.matchAll(/l10nID:\s*"([^"]+)"/g)].map(m => m[1]),
  ]);
  const asked = [...src.matchAll(/_string\(\s*\n?\s*"([^"]+)"/g)].map(m => m[1]);
  ok(asked.length >= 3, `${asked.length} strings are asked for by id`);
  for (const id of new Set(asked)) {
    ok(loaded.has(id), `${id} is among the ids that get loaded`);
  }
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
