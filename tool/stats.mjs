// What can be known about zotLook's reach without asking anyone: the
// download count of every release, the repository's traffic, and — from a
// web server log — how many update checks arrive per day.
//
//   node tool/stats.mjs                 GitHub: downloads, stars, traffic
//   node tool/stats.mjs --log FILE...   update checks per day from access logs
//
// Zotero has no telemetry and publishes no install counts. Two proxies come
// close. Every installed copy downloads a new release exactly once, so the
// downloads of the latest release, a week after it went out, are about the
// active installed base. And every copy asks update.json about once a day
// while Zotero runs, so the checks per day are about the copies in use that
// day. The log is read for the request line and the date only; the server
// truncates addresses before it writes them, and nothing here reads them.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const REPO = 'fre-ms/zotLook';
const gh = (path, jq) => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }));

function github() {
  const releases = gh(`repos/${REPO}/releases?per_page=50`);
  console.log('Downloads per release (each installed copy fetches a new release once):');
  for (const r of releases) {
    const n = r.assets.reduce((s, a) => s + a.download_count, 0);
    console.log(`  ${r.tag_name.padEnd(8)} ${r.published_at.slice(0, 10)}  ${String(n).padStart(5)}`);
  }
  const repo = gh(`repos/${REPO}`);
  console.log(`\nStars ${repo.stargazers_count}, watchers ${repo.subscribers_count}, forks ${repo.forks_count}`);
  try {
    const views = gh(`repos/${REPO}/traffic/views`);
    const clones = gh(`repos/${REPO}/traffic/clones`);
    console.log(`Last 14 days: ${views.count} views (${views.uniques} unique), ` +
      `${clones.count} clones (${clones.uniques} unique; mostly bots and the docs build)`);
    const refs = gh(`repos/${REPO}/traffic/popular/referrers`);
    for (const r of refs) console.log(`  from ${r.referrer}: ${r.count} views, ${r.uniques} unique`);
  } catch {
    console.log('(traffic needs push access to the repository)');
  }
}

/** "GET /update.json" requests per day, from Apache or nginx combined logs. */
export function updateChecks(texts) {
  const perDay = new Map();
  const line = /\[(\d{2})\/(\w{3})\/(\d{4}):[^\]]*\] "(?:GET|HEAD) \/update\.json[ ?]/;
  const months = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  for (const text of texts) {
    for (const l of text.split('\n')) {
      const m = l.match(line);
      if (!m) continue;
      const day = `${m[3]}-${months[m[2]]}-${m[1]}`;
      perDay.set(day, (perDay.get(day) || 0) + 1);
    }
  }
  return [...perDay.entries()].sort();
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const args = process.argv.slice(2);
  if (args[0] === '--log') {
    const files = args.slice(1);
    if (!files.length) { console.error('usage: node tool/stats.mjs --log FILE...'); process.exit(2); }
    const rows = updateChecks(files.map((f) => fs.readFileSync(f, 'utf8')));
    console.log('Update checks per day (about the copies in use that day):');
    for (const [day, n] of rows) console.log(`  ${day}  ${String(n).padStart(5)}`);
    if (!rows.length) console.log('  none found — is update.json served from this host yet?');
  } else {
    github();
  }
}
