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
// Only a release build counts. On a machine without a Swift toolchain build.sh
// deliberately packages everything except the macOS helper, and leaves
// update.json alone for exactly this reason: that package must never be what
// an installed copy auto-updates to. Zip keeps its entry names in the clear,
// so the helper's presence is what tells the two builds apart.
const xpi = ROOT + `build/zotlook-${man.version}.xpi`;
if (!fs.existsSync(xpi)) {
  console.log('ok    (no local XPI to hash-check; run build.sh first)');
} else {
  const bytes = fs.readFileSync(xpi);
  if (bytes.includes('qlpreview')) {
    const { createHash } = await import('node:crypto');
    const sha = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
    eq(e.update_hash, sha, 'update_hash matches the built XPI');
  } else {
    console.log('ok    (local XPI has no macOS helper, so it is not a release build)');
  }
}


// ── the version the site claims ───────────────────────────────────────
// The JSON-LD on both front pages carries a softwareVersion by hand, and a
// hand-kept number goes stale silently: it said 1.1.6 while 1.1.7 was out,
// and nothing anywhere would have failed over it.
for (const lang of ['de', 'en']) {
  const src = fs.readFileSync(`${ROOT}doc/${lang}/index.qmd`, 'utf8');
  const claimed = src.match(/"softwareVersion":\s*"([^"]+)"/);
  ok(claimed, `${lang}: the front page states a version`);
  eq(claimed[1], man.version, `${lang}: and it is the one in the manifest`);
}

// ── the README badges, held against what they claim ───────────────────
// A badge is a claim in a picture, and a picture does not fail a build when
// it goes stale. These are the two that can: the Zotero range comes from the
// manifest, and the platform list from what the plugin actually drives.
{
  const readme = fs.readFileSync(ROOT + 'README.md', 'utf8');
  const badges = [...readme.matchAll(/!\[[^\]]*\]\((https:\/\/img\.shields\.io[^)]*)\)/g)]
    .map(m => decodeURIComponent(m[1]));

  ok(badges.length >= 4, `the head carries badges (${badges.length})`);

  // The badge names the version zotLook is developed and tested against, and
  // that is deliberately narrower than the range it installs into. Claiming
  // the whole installable range would be claiming 7, 8 and 9, which have
  // never been run — EPUB.mjs, which everything EPUB is built on, does not
  // exist before Zotero 8 at all. So the badge is held against
  // strict_max_version, and the gap below it has to be spoken for in prose
  // rather than left for a reader to discover.
  const zotero = badges.find(b => /badge\/Zotero-/.test(b));
  ok(zotero, 'one of them states the Zotero version');
  const shown = zotero.match(/badge\/Zotero-([^-?]+)/)[1];
  const min = z.strict_min_version, max = z.strict_max_version;
  eq(shown, max.replace(/\.\*$/, ''),
     `the badge says ${shown}, the version tested, which is manifest ${max}`);
  ok(!/[–-]/.test(shown),
     'and states one version rather than a range it has not been run across');

  // The manifest stays open below it on purpose, so that anyone on an older
  // Zotero can try; that is only defensible while the README says as much.
  eq(min, '6.999', 'the manifest still installs on Zotero 7, as Zotero writes it');
  ok(/## Older versions of Zotero/.test(readme),
     'and the README has a section about what that does and does not mean');
  ok(/EPUB\.mjs/.test(readme) && /Zotero 8/.test(readme),
     'naming the one dependency that certainly is not there below Zotero 8');

  // The platform badge against the platforms the plugin actually drives
  const platforms = badges.find(b => /macOS/.test(b) && !/Zotero/.test(b));
  ok(platforms, 'one of them lists the platforms');
  for (const name of ['macOS', 'Linux', 'Windows']) {
    ok(platforms.includes(name), `  including ${name}`);
  }
  const src = fs.readFileSync(ADDON + 'zotlook.js', 'utf8');
  ok(/isMac/.test(src) && /isLinux/.test(src) && /isWin/.test(src),
     'and the plugin has a route for each of the three');

  // Nothing that ages badly: a "last commit" or "downloads" badge reads worse
  // the longer a finished plugin stays finished.
  ok(!badges.some(b => /last-commit|release-date/.test(b)),
     'and none of them turns into a reproach as time passes');
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

// ── the development install must address the same plugin ──────────────
// tool/dev.mjs writes a proxy file named after the plugin id. Reading that id
// from the manifest is what keeps the two in step: a hard-coded copy would go
// on installing under the old name after a rename, and the symptom is a
// profile with no plugin in it and nothing anywhere saying why.
{
  const dev = fs.readFileSync(ROOT + 'tool/dev.mjs', 'utf8');
  ok(/manifest\.json/.test(dev), 'dev.mjs reads the manifest');
  ok(/applications\.zotero\.id/.test(dev),
     'and takes the plugin id from it');
  eq(dev.includes(z.id), false,
     `rather than carrying a copy of ${z.id}`);
  // Against the spawn arguments, not against the file: the first version of
  // this check matched the word anywhere, and the comment above restart()
  // explains why the flag is needed — so deleting the flag left the comment
  // and the check went on passing.
  const args = (dev.match(/spawn\(zoteroBinary\(\),\s*(\[[^\]]*\])/) || [])[1];
  ok(args, 'dev.mjs starts Zotero');
  ok(/--purgecaches/.test(args || ''),
     'with --purgecaches, or bootstrap.js is served from yesterday\'s cache');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
