// The development install, driven end to end against a throwaway profile.
//
// Nothing here may touch the Zotero of whoever runs the suite, which is why
// dev.mjs takes ZOTERO_BIN and ZOTERO_QUIT: both are pointed at stubs that
// record what they were asked to do. What is under test is the part that
// cannot be read off the source — that the proxy file, the set-aside package,
// the re-enable and the restart really happen, in that order, and that a
// burst of writes produces one restart rather than a storm of them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT } from './load.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zotlook-dev-'));
const ID = JSON.parse(fs.readFileSync(ROOT + 'addon/manifest.json', 'utf8'))
  .applications.zotero.id;

/** A profile as Zotero leaves one: a packaged plugin, and it disabled. */
function makeProfile(name, { disabled = true, packaged = true } = {}) {
  const profile = path.join(TMP, name);
  fs.mkdirSync(path.join(profile, 'extensions'), { recursive: true });
  if (packaged) {
    fs.writeFileSync(path.join(profile, 'extensions', ID + '.xpi'), 'packaged');
  }
  fs.writeFileSync(path.join(profile, 'extensions.json'), JSON.stringify({
    schemaVersion: 35,
    addons: [
      { id: ID, active: !disabled, userDisabled: disabled },
      { id: 'someone.else@example.org', active: true, userDisabled: false },
    ],
  }));
  return profile;
}

/** Stubs that write their arguments where the test can read them. */
function makeStubs(name) {
  const dir = path.join(TMP, name + '-stubs');
  fs.mkdirSync(dir, { recursive: true });
  const log = path.join(dir, 'calls.txt');
  const bin = path.join(dir, 'zotero');
  fs.writeFileSync(bin, `#!/bin/sh\necho "start $@" >> "${log}"\n`);
  fs.chmodSync(bin, 0o755);
  const quit = path.join(dir, 'quit');
  fs.writeFileSync(quit, `#!/bin/sh\necho "quit" >> "${log}"\n`);
  fs.chmodSync(quit, 0o755);
  return { bin, quit, log,
    calls: () => (fs.existsSync(log)
      ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []) };
}

const run = (args, env = {}) => spawnSync('node', [ROOT + 'tool/dev.mjs', ...args],
  { encoding: 'utf8', env: { ...process.env, ...env } });

// ── install, and what it leaves behind ────────────────────────────────
{
  const profile = makeProfile('install');
  const out = run(['--install', '--profile', profile]);
  eq(out.status, 0, 'the install succeeds: ' + (out.stderr || '').trim());

  const proxy = path.join(profile, 'extensions', ID);
  ok(fs.existsSync(proxy), 'a proxy file named after the plugin id appears');
  eq(fs.readFileSync(proxy, 'utf8'), ROOT + 'addon',
     'holding the absolute path to the working tree');

  eq(fs.existsSync(path.join(profile, 'extensions', ID + '.xpi')), false,
     'the packaged copy is out of the way');
  ok(fs.existsSync(path.join(profile, 'extensions', ID + '.xpi.packaged')),
     'set aside rather than deleted, so it can come back');

  // A plugin disabled once stays disabled however it is installed, and the
  // symptom is a profile with no plugin in it and nothing saying why
  const json = JSON.parse(fs.readFileSync(path.join(profile, 'extensions.json'), 'utf8'));
  const mine = json.addons.find((a) => a.id === ID);
  eq([mine.active, mine.userDisabled], [true, false], 'and it is re-enabled');
  const other = json.addons.find((a) => a.id !== ID);
  eq([other.id, other.active], ['someone.else@example.org', true],
     'while another plugin in the same file is left alone');
}

// ── restore puts the profile back exactly as it was ───────────────────
{
  const profile = makeProfile('restore');
  const before = fs.readFileSync(path.join(profile, 'extensions', ID + '.xpi'));
  run(['--install', '--profile', profile]);
  const out = run(['--restore', '--profile', profile]);
  eq(out.status, 0, 'restore succeeds');

  eq(fs.existsSync(path.join(profile, 'extensions', ID)), false,
     'the proxy file is gone');
  const xpi = path.join(profile, 'extensions', ID + '.xpi');
  ok(fs.existsSync(xpi), 'and the package is back where Zotero looks for it');
  eq(fs.readFileSync(xpi).equals(before), true, 'byte for byte');
  eq(fs.existsSync(xpi + '.packaged'), false, 'with nothing left lying about');
}
{
  // Restoring a profile that never had a package must not invent one
  const profile = makeProfile('restore-none', { packaged: false });
  run(['--install', '--profile', profile]);
  const out = run(['--restore', '--profile', profile]);
  eq(out.status, 0, 'restore succeeds with nothing set aside');
  ok(/no packaged copy/.test(out.stdout), 'and says so rather than pretending');
  eq(fs.existsSync(path.join(profile, 'extensions', ID + '.xpi')), false,
     'no package is conjured up');
}

// ── the restart, against stubs rather than a real Zotero ──────────────
{
  const profile = makeProfile('restart');
  const stub = makeStubs('restart');
  const out = run(['--install', '--profile', profile]);
  eq(out.status, 0, 'installed');

  // --install alone must not start anything: it is the half of the job for
  // someone who wants to launch Zotero themselves
  eq(stub.calls().length, 0, 'plain --install starts nothing');
}
{
  const profile = makeProfile('watch');
  const stub = makeStubs('watch');
  const child = spawn('node', [ROOT + 'tool/dev.mjs', '--profile', profile], {
    env: { ...process.env, ZOTERO_BIN: stub.bin, ZOTERO_QUIT: stub.quit },
    stdio: 'ignore',
  });

  const settle = (ms) => new Promise((r) => setTimeout(r, ms));
  await settle(1200);

  const first = stub.calls();
  eq(first[0], 'quit', 'the running Zotero is asked to close first');
  ok(/^start /.test(first[1] || ''), 'then one is started');
  ok(/--purgecaches/.test(first[1] || ''),
     'with --purgecaches: bootstrap.js is cached by Zotero, not by the plugin');
  ok((first[1] || '').includes(profile), 'and pointed at this profile');

  // A burst of writes, as an editor and a formatter between them produce
  const target = ROOT + 'addon/zotlook.js';
  const body = fs.readFileSync(target);
  try {
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(target, body);
      await settle(30);
    }
    await settle(1500);
    const after = stub.calls().length - first.length;
    eq(after, 2, 'a burst of five writes costs one quit and one start, not five');
  } finally {
    fs.writeFileSync(target, body);
    child.kill();
  }
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
