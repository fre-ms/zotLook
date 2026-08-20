// Guards the stale-code traps that made a fresh install run old modules:
// a script loader that hands back the previous compilation, and a helper
// binary from an earlier version whose argument contract has since changed.
import fs from 'node:fs';
import { ADDON, loadPlugin } from './load.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

const bootstrap = fs.readFileSync(ADDON+'bootstrap.js','utf8');

// ── module loading must bypass the script cache ───────────────────────
ok(/loadSubScriptWithOptions/.test(bootstrap),
   'modules are loaded through loadSubScriptWithOptions');
ok(/ignoreCache:\s*true/.test(bootstrap),
   'and with ignoreCache, so a reinstall cannot run the previous compilation');
eq(/Services\.scriptloader\.loadSubScript\(/.test(bootstrap), false,
   'no plain loadSubScript remains');
ok(/target:\s*globalThis/.test(bootstrap), 'loaded into the shared plugin scope');

// every module the plugin defines must actually be listed for loading
const listed = bootstrap.match(/SCRIPTS = \[([^\]]+)\]/)[1]
  .match(/"([^"]+)"/g).map(s => s.replace(/"/g, ''));
eq(listed, ['util.js', 'sheet.js', 'epub.js', 'winpreview.js', 'zotlook.js'],
   'every module is loaded, in dependency order');
for (const f of listed) ok(fs.existsSync(ADDON + f), `${f} ships`);

// ── the deployed binary must not outlive its version ──────────────────
{
  const { ZotLook: Q } = loadPlugin();
  Q.version = '1.1.0';
  Q._getTempDirPath = () => '/tmp/zt';
  let written = null;
  const seen = new Set();
  const IOUtils = {
    exists: async (p) => seen.has(p),
    makeDirectory: async () => {},
    write: async (p) => { written = p; seen.add(p); },
    setPermissions: async () => {},
  };
  const { ZotLook: P } = loadPlugin({ IOUtils });
  P.version = '1.1.0';
  P.rootURI = 'file:///plugin/';
  globalThis.fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(4) });

  const path = await P._ensureBinary('qlpreview');
  ok(path && path.includes('1.1.0'), `binary path is stamped with the version (${path})`);
  eq(written, path, 'and it was actually deployed there');

  // A different version must not reuse it
  const { ZotLook: R } = loadPlugin({ IOUtils });
  R.version = '1.2.0';
  R.rootURI = 'file:///plugin/';
  const other = await R._ensureBinary('qlpreview');
  ok(other !== path, 'a later version deploys to a different path');
  ok(other.includes('1.2.0'), 'stamped with its own version');
}

// ── nothing may block the main thread at startup ──────────────────────
// A synchronous Localization does synchronous file access; doing that while
// Zotero is starting is how a plugin makes the whole window feel slow.
{
  const src = fs.readFileSync(ADDON+'zotlook.js','utf8');
  eq(/formatValueSync/.test(src), false, 'no synchronous string formatting');
  eq(/new Localization\([^)]*,\s*true\s*\)/.test(src), false,
     'no Localization is constructed in synchronous mode');
  ok(/await l10n\.formatValues/.test(src), 'strings are fetched asynchronously');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
