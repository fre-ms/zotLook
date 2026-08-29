// Guards the two mistakes that made the pane neither visible nor functional:
// labels that never resolve because the FTL is not linked into the preferences
// window, and controls built at script-load time, before the fragment exists.
import fs from 'node:fs';
import { ADDON } from './load.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

const xhtml = fs.readFileSync(ADDON+'prefs-pane.xhtml','utf8');
const js = fs.readFileSync(ADDON+'prefs-pane.js','utf8');
const paneCss = fs.readFileSync(ADDON+'prefs-pane.css','utf8');
const zotlook = fs.readFileSync(ADDON+'zotlook.js','utf8');

// ── the fragment must be well-formed once wrapped ─────────────────────
// Two top-level elements are legal here: Zotero inserts this as a fragment.
{
  const { DOMParser } = await import('linkedom');
  const wrapped = '<root>' + xhtml.replace(/<!--[\s\S]*?-->/g, '') + '</root>';
  const doc = new DOMParser().parseFromString(wrapped, 'text/xml');
  ok(doc && !doc.querySelector('parsererror'), 'pane fragment parses');
}

// ── the FTL must be linked, or every label renders blank ──────────────
ok(/rel="localization"/.test(xhtml), 'pane links a localization resource');
const linked = xhtml.match(/rel="localization"\s+href="([^"]+)"/);
ok(linked, 'the linkset names an FTL file');
const declaredFile = zotlook.match(/L10N_FILE:\s*"([^"]+)"/)[1];
eq(linked[1], declaredFile, 'it is the same bundle the plugin registers');
ok(fs.existsSync(`${ADDON}locale/en-US/${linked[1]}`), 'and that bundle ships');

// ── controls must exist in the markup, not be built at load time ──────
const ACTIONS = ['preview', 'notes', 'contactSheet'];
for (const action of ACTIONS) {
  ok(xhtml.includes(`id="zotlook-key-${action}"`), `${action}: button declared in markup`);
  ok(xhtml.includes(`id="zotlook-clear-${action}"`), `${action}: reset button declared in markup`);
  ok(js.includes(`"${action}"`), `${action}: wired up by the script`);
}
ok(!/createElement\(\s*["']tr["']/.test(js), 'no rows are built in script');

// ── nothing may touch the DOM before the fragment is inserted ─────────
ok(/MutationObserver/.test(js), 'the script waits for its root node');
ok(/getElementById\(["']zotlook-prefs["']\)/.test(js), 'and waits for the right node');
ok(/id="zotlook-prefs"/.test(xhtml), 'which the markup actually declares');

// ── key capture has to bypass the preferences window's own handling ───
ok(/addEventListener\(\s*["']keydown["']\s*,\s*\w+\s*,\s*true\s*\)/.test(js),
   'keydown is captured, not left to bubble into the window');
ok(/removeEventListener\(\s*["']keydown["']/.test(js), 'and detached again');
ok(/removeEventListener\(\s*["']keyup["']/.test(js), 'keyup detached too');
ok(/Escape/.test(js), 'Escape abandons the recording');

// ── the number field binds natively ───────────────────────────────────
ok(/preference="extensions\.zotlook\.contactSheetMaxPages"/.test(xhtml),
   'the page limit binds through the preference attribute');
ok(/type="number"/.test(xhtml) && /min="0"/.test(xhtml), 'and is a number field starting at 0');


// ── the kept sheets can be got rid of from here ───────────────────────
// A cache with no way to empty it and no figure beside it is a directory the
// user has to be told about in the documentation and then find by hand.
ok(/id="zotlook-purge-sheets"/.test(xhtml), 'the pane offers a delete button');
ok(/id="zotlook-cache-size"/.test(xhtml),
   'with a place for the figure, without which pressing it is a guess');
ok(/#zotlook-purge-sheets/.test(js) && /addEventListener\(\s*["']command["']/.test(js),
   'and the button is wired, not merely declared');
ok(/_purgeSheets\(/.test(js), 'to the clearing the plugin implements');
ok(/_keptSheetsSize\(/.test(js), 'and the figure to the size it reports');
ok(/preference="extensions\.zotlook\.contactSheetKeepDays"/.test(xhtml),
   'the keep-days field binds through the preference attribute');
ok(/pref\("extensions\.zotlook\.contactSheetKeepDays"/.test(
     fs.readFileSync(ADDON+'prefs.js','utf8')),
   'and has a default, or the field opens blank');

// ── explanations sit with the setting they explain ────────────────────
for (const loc of ['en-US', 'de-DE']) {
  const ftl = fs.readFileSync(`${ADDON}locale/${loc}/zotlook.ftl`, 'utf8');
  const intro = ftl.match(/^zotlook-prefs-contactsheet-help = (.+)$/m);
  const limit = ftl.match(/^zotlook-prefs-contactsheet-maxpages-help = (.+)$/m);
  ok(intro, `${loc}: the section has a short introduction`);
  ok(intro[1].length < 120, `${loc}: which stays short (${intro[1].length} chars)`);
  ok(limit, `${loc}: the page limit has its own explanation`);
  ok(limit[1].length > 200, `${loc}: which is substantive (${limit[1].length} chars)`);
  ok(/\b0\b/.test(limit[1]), `${loc}: and says what 0 means`);
}

// The long explanation describes the page limit, so it has to sit with that
// control and not above the column setting, which it never mentions.
{
  const columnsAt = xhtml.indexOf('zotlook-prefs-contactsheet-columns"');
  const limitHelpAt = xhtml.indexOf('zotlook-prefs-contactsheet-maxpages-help');
  const limitAt = xhtml.indexOf('zotlook-prefs-contactsheet-maxpages"');
  ok(columnsAt > 0 && limitHelpAt > 0 && limitAt > 0, 'all three are present');
  ok(limitHelpAt > columnsAt, 'the limit explanation comes after the column setting');
  ok(limitHelpAt < limitAt, 'and immediately before the limit it explains');
}

// ── the shipped default is "no limit" ─────────────────────────────────
const prefs = fs.readFileSync(ADDON+'prefs.js','utf8');
const dflt = prefs.match(/pref\("extensions\.zotlook\.contactSheetMaxPages",\s*(\d+)\)/);
ok(dflt, 'the page limit has a default');
eq(dflt[1], '0', 'which is 0, meaning no limit');

// ── every id the pane uses is styled or at least declared ─────────────
for (const cls of ['zotlook-row', 'zotlook-key-button', 'zotlook-conflict']) {
  ok(xhtml.includes(cls), `markup uses .${cls}`);
  ok(paneCss.includes(cls), `stylesheet defines .${cls}`);
}
ok(/stylesheets:\s*\[[^\]]*prefs-pane\.css/.test(zotlook), 'the stylesheet is registered with the pane');

// ── the attachment order UI ───────────────────────────────────────────
{
  const ACTION_TYPES = ['pdf','epub','html','image','video','other'];
  for (const t of ACTION_TYPES) {
    ok(xhtml.includes(`data-type="${t}"`), `${t}: has a row`);
    ok(xhtml.includes(`zotlook-prefs-type-${t}`), `${t}: has a label id`);
  }
  ok(/id="zotlook-order-up"/.test(xhtml) && /id="zotlook-order-down"/.test(xhtml),
     'reordering is done with buttons, operable from the keyboard');
  ok(/menuitem value="type"/.test(xhtml) && /menuitem value="first"/.test(xhtml),
     'both selection modes are offered');
  eq(/type="checkbox"/.test(xhtml), false,
     'no checkboxes: the ranking alone expresses the priority');
  ok(/data-selected/.test(js), 'the script tracks which row is selected');
  ok(/formatAttachmentOrder/.test(js), 'and stores the result through the shared helper');

  // the rows must cover exactly the types the plugin knows
  const { ZotLookUtil } = (await import('./load.mjs')).loadPlugin();
  const rows = [...xhtml.matchAll(/class="zotlook-order-row" data-type="([^"]+)"/g)].map(m => m[1]);
  eq(rows.sort(), ZotLookUtil.ATTACHMENT_TYPES.slice().sort(),
     'the list offers exactly the types the picker understands');
}

// ── the annotation switch says what it governs ────────────────────────
// It reaches the preview and the contact sheet alike, so a label naming only
// one of them would understate it.
for (const loc of ['en-US', 'de-DE']) {
  const ftl = fs.readFileSync(`${ADDON}locale/${loc}/zotlook.ftl`, 'utf8');
  ok(/preference="extensions\.zotlook\.previewAnnotations"/.test(xhtml),
     `${loc}: the switch is bound to the preference`);
  const label = ftl.match(/^zotlook-prefs-pdf-annotations =\n\s+\.label = (.+)$/m);
  ok(label, `${loc}: the switch has a label`);
  ok(/sheet|übersicht/i.test(label[1]),
     `${loc}: which names the contact sheet too (${label[1]})`);
  const help = ftl.match(/^zotlook-prefs-pdf-help = (.+)$/m);
  ok(/off|aus/i.test(help[1]), `${loc}: and the help says what turning it off does`);
}
{
  const prefs = fs.readFileSync(ADDON + 'prefs.js', 'utf8');
  ok(/pref\("extensions\.zotlook\.previewAnnotations",\s*true\)/.test(prefs),
     'and it ships switched on');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
