// Runs every *.test.mjs in this directory and reports a combined tally.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const suites = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort();

let assertions = 0;
let failed = 0;

for (const suite of suites) {
  const run = spawnSync(process.execPath, [dir + suite], { encoding: 'utf8' });
  const out = (run.stdout || '') + (run.stderr || '');
  const passed = (out.match(/^ok {2}/gm) || []).length;
  assertions += passed;
  if (run.status !== 0) {
    failed++;
    console.log(`\n=== ${suite} FAILED ===\n${out}`);
  } else {
    console.log(`${suite.padEnd(22)} ${String(passed).padStart(3)} assertions ok`);
  }
}

console.log('-'.repeat(40));
console.log(`${assertions} assertions, ${suites.length} suites, ${failed} failing`);
process.exit(failed ? 1 : 0);
