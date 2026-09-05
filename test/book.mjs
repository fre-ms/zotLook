// The two readers the platform provides, stood in for.
//
// Zotero hands the module an nsIZipReader and its own EPUB class; neither
// exists here. The zip is shelled out to unzip, one entry at a time, which is
// what a zip reader does; the book is the same manifest-and-spine join Zotero
// performs. What the tests are then about is everything the module does with
// what those two hand it.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadPlugin } from './load.mjs';

export const IOUtils = {
  exists: async p => fs.existsSync(p),
  stat: async p => { const s = fs.statSync(p); return { size: s.size, lastModified: Math.floor(s.mtimeMs) }; },
  readUTF8: async p => fs.readFileSync(p, 'utf8'),
  writeUTF8: async (p, d) => fs.writeFileSync(p, d),
  makeDirectory: async (p) => fs.mkdirSync(p, { recursive: true }),
  remove: async (p, o = {}) => { try { fs.rmSync(p, { recursive: !!o.recursive, force: !!o.ignoreAbsent }); } catch (e) { if (!o.ignoreAbsent) throw e; } },
};

export const counts = { opened: 0 };

export const entryList = (archive) =>
  execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' })
    .split('\n').map(l => l.trim()).filter(Boolean);
export const entryBuffer = (archive, entry) =>
  execFileSync('unzip', ['-p', archive, entry], { maxBuffer: 64 * 1024 * 1024 });

export function openZip(archive) {
  counts.opened++;
  const names = new Set(entryList(archive));
  return {
    archive,
    hasEntry: (e) => names.has(e),
    getEntry: (e) => ({ realSize: entryBuffer(archive, e).length }),
    getInputStream: (e) => ({ buf: entryBuffer(archive, e), close() {} }),
    close() {},
  };
}

export const host = {
  File: {
    getContentsAsync: async (stream) => stream.buf.toString('utf8'),
    getBinaryContentsAsync: async (stream) => stream.buf.toString('binary'),
  },
};

export const plugin = loadPlugin({ IOUtils, zotero: host });
const U = plugin.zotLookUtil;

export const extractEntry = (zip, entry, destPath) =>
  fs.writeFileSync(destPath, entryBuffer(zip.archive, entry));

/** Stands in for Zotero's EPUB: the spine, in reading order, as documents. */
export function openBook(archive) {
  const zip = openZip(archive);
  counts.opened--;   // the book's own handle is not what the reuse counts measure
  const read = (e) => entryBuffer(archive, e).toString('utf8');
  const container = U.parseStrict(read('META-INF/container.xml'), 'application/xml');
  const opfPath = container.querySelector('rootfile').getAttribute('full-path');
  const opf = U.parseStrict(read(opfPath), 'application/xml');
  const cut = opfPath.lastIndexOf('/');
  const dir = cut === -1 ? '' : opfPath.substring(0, cut);
  const byId = new Map();
  for (const item of opf.querySelectorAll('manifest item')) {
    byId.set(item.getAttribute('id'),
             U.resolveRelativePath(item.getAttribute('href'), dir).path);
  }
  return {
    close() { zip.close(); },
    async* getSectionDocuments() {
      for (const ref of opf.querySelectorAll('spine itemref')) {
        const href = byId.get(ref.getAttribute('idref'));
        if (!href || !zip.hasEntry(href)) continue;
        yield { href, doc: U.parseStrict(read(href), 'application/xhtml+xml') };
      }
    },
  };
}

/**
 * A minimal but real EPUB on disk, zipped.
 *
 * @param {string} dir  a scratch directory; the archive lands beside it
 * @param {object} [opts]
 * @param {string} [opts.nav]       navigation document, EPUB 3
 * @param {string} [opts.ncx]       NCX, EPUB 2
 * @param {string[]} [opts.chapters] each chapter's body markup
 * @param {string|null} [opts.cover] how the book names its cover picture:
 *   'epub3' by properties="cover-image", 'epub2' by <meta name="cover"> with
 *   the item's id, 'href' by that meta with the file's name; null for none
 */
export function makeBook(dir, { nav = null, ncx = null, sharedImage = false,
                        repeated = false, chapters = null, cover = null } = {}) {
  fs.mkdirSync(dir + '/META-INF', { recursive: true });
  fs.mkdirSync(dir + '/OEBPS', { recursive: true });
  fs.writeFileSync(dir + '/mimetype', 'application/epub+zip');
  fs.writeFileSync(dir + '/META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" '
    + 'xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
    + '<rootfile full-path="OEBPS/content.opf" '
    + 'media-type="application/oebps-package+xml"/></rootfiles></container>');
  if (sharedImage) fs.writeFileSync(dir + '/OEBPS/shared.png', 'x');
  const picture = sharedImage ? '<img src="shared.png" alt="s"/>' : '';
  const echo = repeated ? '<p>Ein wiederholter Satz.</p>' : '';
  const bodies = chapters || [
    `<h1 id="intro">First</h1>${picture}<p>Body of chapter 1.</p>${echo}`,
    `<h1>Second</h1>${picture}<p>Body of chapter 2.</p>${echo}`,
  ];
  bodies.forEach((body, i) => {
    fs.writeFileSync(`${dir}/OEBPS/ch${i + 1}.xhtml`,
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" '
      + 'xmlns:epub="http://www.idpf.org/2007/ops"><head>'
      + `<title>Chapter ${i + 1}</title></head><body>${body}</body></html>`);
  });
  let items = bodies.map((_, i) =>
    `<item id="c${i + 1}" href="ch${i + 1}.xhtml" `
    + 'media-type="application/xhtml+xml"/>').join('');
  let spineAttr = '';
  if (nav) {
    fs.writeFileSync(dir + '/OEBPS/nav.xhtml', nav);
    items += '<item id="nav" href="nav.xhtml" properties="nav" '
      + 'media-type="application/xhtml+xml"/>';
  }
  if (ncx) {
    fs.writeFileSync(dir + '/OEBPS/toc.ncx', ncx);
    items += '<item id="ncx" href="toc.ncx" '
      + 'media-type="application/x-dtbncx+xml"/>';
    spineAttr = ' toc="ncx"';
  }
  let meta = '';
  if (cover) {
    fs.mkdirSync(dir + '/OEBPS/images', { recursive: true });
    fs.writeFileSync(dir + '/OEBPS/images/front.png', 'PNG-bytes');
    items += '<item id="cover-pic" href="images/front.png" media-type="image/png"'
      + (cover === 'epub3' ? ' properties="cover-image"' : '') + '/>';
    if (cover === 'epub2') meta = '<meta name="cover" content="cover-pic"/>';
    if (cover === 'href') meta = '<meta name="cover" content="images/front.png"/>';
  }
  fs.writeFileSync(dir + '/OEBPS/content.opf',
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" '
    + 'version="3.0" unique-identifier="i"><metadata '
    + 'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>A Book</dc:title>'
    + meta + '</metadata><manifest>' + items + '</manifest>'
    + `<spine${spineAttr}>`
    + bodies.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('')
    + '</spine>'
    + '</package>');
  const epub = dir + '.epub';
  execFileSync('zip', ['-qr', epub, '.'], { cwd: dir });
  return epub;
}
