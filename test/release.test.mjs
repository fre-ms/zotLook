import fs from 'node:fs';
import { ROOT, ADDON } from './load.mjs';
let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

const man = JSON.parse(fs.readFileSync(ADDON+'manifest.json','utf8'));
const upd = JSON.parse(fs.readFileSync(ROOT+'update.json','utf8'));
const z = man.applications.zotero;

// ── the two files must agree, or auto-update silently does nothing
const ids = Object.keys(upd.addons);
eq(ids, [z.id], 'update.json is keyed on the manifest plugin id');
const entries = upd.addons[z.id].updates;
eq(entries.length, 1, 'exactly one update entry');
const e = entries[0];
eq(e.version, man.version, 'update entry version matches the manifest');

// ── what Zotero's AddonUpdateChecker requires
eq(typeof e.version, 'string', 'version is a string');
ok(e.applications && e.applications.zotero, 'applications.zotero present (gecko is not accepted)');
eq(e.applications.zotero.strict_min_version, z.strict_min_version, 'min version mirrors the manifest');
eq('strict_max_version' in e.applications.zotero, false,
   'no strict_max_version, so the entry stays valid for future Zotero releases');
ok(e.update_link.startsWith('https:'), 'update_link is https, so no hash is strictly required');
ok(/^sha(256|512):[0-9a-f]{64,128}$/.test(e.update_hash), 'update_hash uses an accepted algorithm');

// ── the link has to point at the tag build.sh actually tells you to create
const expected = `https://github.com/fre-ms/zotLook/releases/download/v${man.version}/zotlook-${man.version}.xpi`;
eq(e.update_link, expected, 'update_link matches the release asset build.sh produces');
ok(z.update_url.includes('fre-ms/zotLook'), 'update_url points at the fork');
ok(z.update_url.endsWith('/update.json'), 'update_url points at update.json');
ok(man.homepage_url.includes('fre-ms/zotLook'), 'homepage_url points at the fork');

// ── the hash must describe the file that was actually built, when present
const xpi = ROOT + `build/zotlook-${man.version}.xpi`;
if (fs.existsSync(xpi)) {
  const { createHash } = await import('node:crypto');
  const sha = 'sha256:' + createHash('sha256').update(fs.readFileSync(xpi)).digest('hex');
  eq(e.update_hash, sha, 'update_hash matches the built XPI');
} else {
  console.log('ok    (no local XPI to hash-check; run build.sh first)');
}

// ── MIT attribution must survive the fork
const lic = fs.readFileSync(ROOT+'LICENSE','utf8');
ok(/Guillaume Chapron/.test(lic), 'LICENSE keeps the original copyright notice');
ok(/fre\.ms/.test(lic), 'and carries the fork maintainer alongside it');
ok(lic.indexOf('Guillaume Chapron') < lic.indexOf('fre.ms'),
   'the original author is named first');
ok(/MIT License/.test(lic) && /Permission is hereby granted/.test(lic),
   'the licence text itself is untouched');
ok(/Guillaume Chapron/.test(man.author), 'the manifest names the original author too');
{
  // Roughly half the JavaScript and two thirds of the Swift renderer are still
  // the original author's work, so the upstream project stays credited.
  const readme = fs.readFileSync(ROOT + 'README.md', 'utf8');
  ok(/gchapron\/Zotero7QuickLook/.test(readme), 'the README points at the upstream project');

  // The plugin before it contributed the idea, not the code: one substantive
  // line is shared, and it is a Zotero API call any such plugin must write.
  // Crediting it as an author would be a claim the comparison does not support.
  ok(/mronkko\/ZoteroQuickLook/.test(readme), 'and names the plugin the idea came from');
  ok(/idea, not of code/.test(readme), 'saying plainly what that debt is');
  const man3 = JSON.parse(fs.readFileSync(ADDON + 'manifest.json', 'utf8'));
  ok(!/nkk/.test(man3.author),
     'while the manifest does not list that author, who contributed no code');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
