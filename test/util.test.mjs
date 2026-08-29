import { loadPlugin } from './load.mjs';
const { zotLookUtil: U } = loadPlugin();
let fail = 0;
const eq = (g, w, l) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`\n      got:  ${JSON.stringify(g)}\n      want: ${JSON.stringify(w)}`)); };
const ok = (c, l) => eq(!!c, true, l);

// ── sanitize: the cases a regex gets wrong
const san = (html) => { const d = U.parseLoose('<html><body>'+html+'</body></html>');
  U.sanitize(d.body); return d.body.innerHTML; };
eq(san('<p>hi</p><script>alert(1)</script>'), '<p>hi</p>', 'removes script element');
eq(san('<SCRIPT>alert(1)</SCRIPT><p>k</p>'), '<p>k</p>', 'removes uppercase script');
eq(san('<script type="text/javascript">x()</script><p>k</p>'), '<p>k</p>', 'removes script with attributes');
// The old string-based stripper mangled markup that merely mentioned a tag;
// working on the tree leaves it intact.
eq(san('<div title="a<script>b">t</div>'), '<div title="a<script>b">t</div>', 'attribute merely containing tag text is untouched');
eq(san('<img src="a.png" onerror="alert(1)">'), '<img src="a.png">', 'removes onerror');
eq(san('<div ONCLICK="x()">t</div>'), '<div>t</div>', 'removes uppercase handler');
eq(san('<a href="javascript:alert(1)">x</a>'), '<a>x</a>', 'removes javascript: href');
eq(san('<a href="page.html">x</a>'), '<a href="page.html">x</a>', 'keeps normal href');
eq(san('<iframe src="x"></iframe><p>k</p>'), '<p>k</p>', 'removes iframe');
eq(san('<b>keep <i>me</i></b>'), '<b>keep <i>me</i></b>', 'leaves benign markup');

// ── serialisation: XML self-closing must not survive into HTML output
const d = U.newHtmlDocument();
const frag = U.parseLoose('<html><body><div/><p>after</p></body></html>');
for (const n of [...frag.body.childNodes]) d.body.appendChild(d.importNode(n, true));
const html = U.serializeHtmlDocument(d);
ok(!/<div\/>/.test(html), 'no self-closed <div> in serialised output');
ok(html.startsWith('<!DOCTYPE html>'), 'output carries a doctype');
ok(/<p>after<\/p>/.test(html), 'sibling content survives import');

// ── resolveFileUrl
eq(U.resolveFileUrl('img/x.png', '/tmp/b/OEBPS'), 'file:///tmp/b/OEBPS/img/x.png', 'relative path');
eq(U.resolveFileUrl('../img/x.png', '/tmp/b/OEBPS/text'), 'file:///tmp/b/OEBPS/img/x.png', 'parent traversal');
eq(U.resolveFileUrl('a%20b.png', '/tmp/b'), 'file:///tmp/b/a%20b.png', 'percent-decoded then re-encoded');
eq(U.resolveFileUrl('c.xhtml#sec2', '/tmp/b'), 'file:///tmp/b/c.xhtml#sec2', 'fragment preserved');
eq(U.resolveFileUrl('https://example.com/x', '/tmp/b'), null, 'absolute http left alone');
eq(U.resolveFileUrl('data:image/png;base64,AA', '/tmp/b'), null, 'data URI left alone');
eq(U.resolveFileUrl('javascript:alert(1)', '/tmp/b'), null, 'javascript: refused');
eq(U.resolveFileUrl('#anchor', '/tmp/b'), null, 'bare fragment left alone');

// ── rewriteCssUrls
eq(U.rewriteCssUrls('@font-face{src:url(f/a.otf)}', '/tmp/b'),
   '@font-face{src:url("file:///tmp/b/f/a.otf")}', 'css url rewritten');
eq(U.rewriteCssUrls('a{background:url("https://x/y.png")}', '/tmp/b'),
   'a{background:url("https://x/y.png")}', 'absolute css url untouched');

// ── parseStrict rejects malformed XML
ok(U.parseStrict('<a><b/></a>', 'application/xml'), 'well-formed XML accepted');
// Rejection of malformed XML relies on Gecko emitting a <parsererror> node,
// which the test double does not do; exercised live in Zotero only.

// ── safeName / hashString / escapeHtml
eq(U.safeName('Müller: Notiz/2026', 100), 'M_ller__Notiz_2026', 'safeName');
eq(U.safeName('', 10), 'untitled', 'safeName fallback');
eq(U.hashString('/a') === U.hashString('/a'), true, 'hash stable');

// ── attachment order ──────────────────────────────────────────────────
eq(U.parseAttachmentOrder('pdf,epub,other'), ['pdf','epub','other'], 'plain order');
eq(U.parseAttachmentOrder(' PDF , Epub '), ['pdf','epub'], 'trimmed and case-insensitive');
eq(U.parseAttachmentOrder('pdf,pdf,epub'), ['pdf','epub'], 'duplicates collapse');
eq(U.parseAttachmentOrder('pdf,nonsense,epub'), ['pdf','epub'], 'unknown types are dropped');
eq(U.parseAttachmentOrder(''), [], 'empty string');
eq(U.parseAttachmentOrder(null), [], 'null');
eq(U.parseAttachmentOrder(',,,'), [], 'only separators');
eq(U.formatAttachmentOrder(['pdf','epub']), 'pdf,epub', 'formatting round trips');
eq(U.formatAttachmentOrder(['pdf','bogus']), 'pdf', 'unknown types are not written out');
eq(U.formatAttachmentOrder([]), '', 'an empty order formats to nothing');
eq(U.formatAttachmentOrder(U.parseAttachmentOrder(U.ATTACHMENT_TYPES.join(','))),
   U.ATTACHMENT_TYPES.join(','), 'the full set survives a round trip');

// ── the stored order is completed into a full ranking ─────────────────
eq(U.attachmentOrder('epub,pdf').slice(0, 2), ['epub','pdf'], 'stored types keep their order');
eq(U.attachmentOrder('epub,pdf').sort(), U.ATTACHMENT_TYPES.slice().sort(),
   'and every known type appears exactly once');
eq(U.attachmentOrder(''), U.ATTACHMENT_TYPES, 'an empty setting yields the built-in ranking');
eq(U.attachmentOrder('bogus'), U.ATTACHMENT_TYPES, 'an unusable setting does too');
eq(U.attachmentOrder('other').slice(0, 1), ['other'], 'a single stored type leads');
eq(new Set(U.attachmentOrder('pdf,pdf,epub')).size, U.ATTACHMENT_TYPES.length,
   'duplicates do not produce duplicate ranks');

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
