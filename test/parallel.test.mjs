// The two pieces of arithmetic behind rendering a sheet on several workers.
// Both decide how work is split, and neither shows a symptom when wrong: too
// few workers is merely slow, and a bad split merely uneven.

import { loadPlugin } from './load.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};

const MB = 1024 * 1024;
const on = (cores) => {
  const { zotLook: Q } = loadPlugin({
    Services: { sysinfo: { getProperty: () => cores } },
  });
  return Q;
};

// ── how many renderers to run ─────────────────────────────────────────
{
  const Q = on(10);
  eq(Q._rendererWorkerCount(2 * MB, 0), 4, 'four workers on a roomy machine');
  eq(Q._rendererWorkerCount(2 * MB, 300), 4, 'a high page cap changes nothing');

  // Without a cap the page count is not known yet, so it must not clamp —
  // reading 0 as "one page" would have made this never run in parallel
  eq(Q._rendererWorkerCount(2 * MB), 4, 'no cap does not mean one worker');

  eq(Q._rendererWorkerCount(2 * MB, 2), 2, 'but a cap below the count does');
  eq(Q._rendererWorkerCount(2 * MB, 1), 1, 'a single page needs one');

  // Each worker parses its own copy, so a big document buys fewer of them
  eq(Q._rendererWorkerCount(100 * MB, 0), 2, 'a 100 MB scan gets two');
  eq(Q._rendererWorkerCount(300 * MB, 0), 1, 'a 300 MB one gets a single');
  eq(Q._rendererWorkerCount(0, 0), 4, 'an empty file does not divide by zero');
}
{
  eq(on(2)._rendererWorkerCount(2 * MB, 0), 2, 'never more workers than cores');
  eq(on(1)._rendererWorkerCount(2 * MB, 0), 1, 'one core, one worker');
}
{
  // Zotero has no sysinfo on every platform; a guess beats failing
  const { zotLook: Q } = loadPlugin({ Services: {} });
  eq(Q._rendererWorkerCount(2 * MB, 0), 4, 'an unreadable core count guesses four');
}

// ── how the pages are dealt out ───────────────────────────────────────
{
  const Q = on(10);
  eq(Q._pageSlices(10, 3), [[1, 4, 7, 10], [2, 5, 8], [3, 6, 9]],
     'round-robin, not blocks: heavy pages sit together and would load one worker');
  eq(Q._pageSlices(4, 1), [[1, 2, 3, 4]], 'one worker takes everything');
  eq(Q._pageSlices(2, 4), [[1], [2], [], []],
     'more workers than pages leaves some with nothing, and they must still finish');
  eq(Q._pageSlices(0, 2), [[], []], 'an empty document deals out nothing');

  const slices = Q._pageSlices(37, 4);
  eq(slices.flat().sort((a, b) => a - b), Array.from({length: 37}, (_, i) => i + 1),
     'every page is dealt exactly once');
  eq(Math.max(...slices.map(s => s.length)) - Math.min(...slices.map(s => s.length)), 1,
     'and the piles differ by at most one');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
