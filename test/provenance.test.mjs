// The Origins page states how much of Chapron's code survives, in numbers.
// Numbers in prose go stale the moment the code moves; these hold the page
// to the measurement, in both languages, so that a drift is a failing test
// rather than a claim nobody re-checked.
import fs from 'node:fs';
import { ROOT } from './load.mjs';
import { measure, substantiveLines, methodNames } from '../tool/provenance.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);
const near = (a, b, d) => Math.abs(a - b) <= d;

// ── the measure itself ────────────────────────────────────────────────
eq(substantiveLines('a();\n\n// c\n/* d\n e */\n}\n  b();  \n'), ['a();', 'b();'],
   'blank, comment and punctuation lines are not counted');
eq(methodNames('  init() {\n  if (x) {\n  async _go(a, b) {\n  init() {'), ['init', '_go'],
   'method names are read once each, keywords left out');

const m = measure();
ok(m.today > 3000, `today's plugin has ${m.today} substantive lines`);
ok(m.quicklook.total > 500 && m.quicklook.survived > 100,
   `${m.quicklook.survived} of ${m.quicklook.total} upstream lines survive (${m.quicklook.percent} %)`);
ok(m.methods.total >= 20, `${m.methods.present} of ${m.methods.total} upstream methods are present`);

// ── the page says what the measure says ───────────────────────────────
const EN_WORDS = { tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14,
  fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20 };
const DE_WORDS = { Zehntel: 10, Elftel: 11, Zwölftel: 12, Dreizehntel: 13, Vierzehntel: 14,
  Fünfzehntel: 15, Sechzehntel: 16, Siebzehntel: 17, Achtzehntel: 18, Neunzehntel: 19, Zwanzigstel: 20 };

function figures(text, lang) {
  const pct = lang === 'en'
    ? text.match(/\*\*(\d+) %\*\* of the JavaScript and \*\*(\d+) %\*\* of `bootstrap\.js`/)
    : text.match(/\*\*(\d+) %\*\* des JavaScript und \*\*(\d+) %\*\* von `bootstrap\.js`/);
  const methods = lang === 'en'
    ? text.match(/(\d+) of the original (\d+) methods/)
    : text.match(/(\d+) der ursprünglich (\d+) Methoden/);
  const share = lang === 'en'
    ? text.match(/about a\s+(\w+)\s+of what is here today/)
    : text.match(/etwa ein\s+(\S+)\s+des Bestands/);   // \w stops at an umlaut
  const ronkko = lang === 'en'
    ? text.match(/of (\d+) substantive lines in the\s+original, (\d+) also occur here/)
    : text.match(/Von (\d+) substanziellen Zeilen des Originals\s+finden sich (\d+) auch hier/);
  return {
    quicklook: pct && Number(pct[1]), bootstrap: pct && Number(pct[2]),
    present: methods && Number(methods[1]), total: methods && Number(methods[2]),
    share: share && (lang === 'en' ? EN_WORDS[share[1]] : DE_WORDS[share[1]]),
    ronkkoTotal: ronkko && Number(ronkko[1]), ronkkoSurvived: ronkko && Number(ronkko[2]),
  };
}

for (const lang of ['en', 'de']) {
  const page = fs.readFileSync(ROOT + `doc/${lang}/origins.qmd`, 'utf8');
  const f = figures(page, lang);
  ok(f.quicklook !== null && f.methods !== null && f.share && f.ronkkoTotal !== null,
     `${lang}: the page states all four figures in the expected words`);
  ok(near(f.quicklook, m.quicklook.percent, 2),
     `${lang}: quicklook.js survival ${f.quicklook} % is within 2 points of the measured ${m.quicklook.percent} %`);
  ok(near(f.bootstrap, m.bootstrap.percent, 3),
     `${lang}: bootstrap.js survival ${f.bootstrap} % is within 3 points of the measured ${m.bootstrap.percent} %`);
  eq([f.present, f.total], [m.methods.present, m.methods.total],
     `${lang}: the methods present are stated as measured`);
  ok(near(f.share, m.share, 1),
     `${lang}: "one in ${f.share}" matches the measured one in ${m.share}`);
  eq([f.ronkkoTotal, f.ronkkoSurvived], [m.ronkko.total, m.ronkko.survived],
     `${lang}: the Rönkkö comparison is stated as measured`);
  ok(/provenance\.mjs/.test(page), `${lang}: the page names the tool that measures it`);
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
