// The history is written once, in doc/en/history.qmd, and read from there
// twice: CHANGELOG.md in the repository is generated from it, and so are the
// notes a release is published with. One source, so the three cannot drift.
//
//   node tool/changelog.mjs sync            rewrite CHANGELOG.md
//   node tool/changelog.mjs check           exit 1 when CHANGELOG.md is stale
//   node tool/changelog.mjs notes 1.4.0     print that release's notes
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const HISTORY = ROOT + 'doc/en/history.qmd';
export const CHANGELOG = ROOT + 'CHANGELOG.md';

const HEADING = /^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})(?: \{[^}]*\})?\s*$/;

/** The page's intro and its releases, newest first, each with its body. */
export function parseHistory(text) {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  const lines = body.split('\n');
  const entries = [];
  let intro = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(HEADING);
    if (m) {
      current = { version: m[1], date: m[2], lines: [] };
      entries.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      intro.push(line);
    }
  }
  return {
    intro: intro.join('\n').trim(),
    entries: entries.map((e) => ({ ...e, body: e.lines.join('\n').trim() })),
  };
}

/**
 * Quarto's markup, made plain for GitHub: heading attributes go, a callout
 * becomes a paragraph led by its title, and nothing else is touched.
 */
export function plain(md) {
  return md
    // [ \t]* rather than \s*: \s would swallow the line break after the
    // heading and pull the next paragraph up against it
    .replace(/^(#{1,6} .*?) \{[^}]*\}[ \t]*$/gm, '$1')
    .replace(/^::: \{\.callout-\w+ title="([^"]*)"\}\n([\s\S]*?)\n:::[ \t]*$/gm,
      (_, title, text) => `**${title}.** ${text.trim().replace(/\n/g, ' ')}`)
    .trim();
}

export function toChangelog(text) {
  const { intro, entries } = parseHistory(text);
  const sections = entries.map(
    (e) => `## ${e.version} — ${e.date}\n\n${plain(e.body)}\n`);
  return (
    '<!-- Generated from doc/en/history.qmd by tool/changelog.mjs. Edit there. -->\n' +
    '# Changelog\n\n' + plain(intro) + '\n\n' + sections.join('\n')
  );
}

export function notesFor(text, version) {
  const entry = parseHistory(text).entries.find((e) => e.version === version);
  if (!entry) throw new Error(`no history entry for ${version}`);
  return plain(entry.body) + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, arg] = process.argv.slice(2);
  const text = fs.readFileSync(HISTORY, 'utf8');
  if (command === 'sync') {
    fs.writeFileSync(CHANGELOG, toChangelog(text));
    console.log('CHANGELOG.md written from doc/en/history.qmd');
  } else if (command === 'check') {
    const stale = !fs.existsSync(CHANGELOG)
      || fs.readFileSync(CHANGELOG, 'utf8') !== toChangelog(text);
    if (stale) {
      console.error('CHANGELOG.md is out of step with doc/en/history.qmd; run: node tool/changelog.mjs sync');
      process.exit(1);
    }
    console.log('CHANGELOG.md is in step');
  } else if (command === 'notes' && arg) {
    process.stdout.write(notesFor(text, arg));
  } else {
    console.error('usage: node tool/changelog.mjs sync | check | notes <version>');
    process.exit(2);
  }
}
