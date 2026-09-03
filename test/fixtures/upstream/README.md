# Upstream sources, for the provenance measurement

`tool/provenance.mjs` measures how much of the upstream code survives in
zotLook, and `test/provenance.test.mjs` holds the figures on the Origins
page to that measurement.

- `chapron-quicklook.js`, `chapron-bootstrap.js` — Guillaume Chapron's
  [Zotero7QuickLook](https://github.com/gchapron/Zotero7QuickLook) at its
  last commit, 25a968065623 of 6 May 2026. MIT licence, © Guillaume Chapron;
  the plugin this fork comes from.
- `ronkko-zoteroquicklook.sha1.json` — Mikko Rönkkö's
  [ZoteroQuickLook](https://github.com/mronkko/ZoteroQuickLook),
  `chrome/content/zoteroquicklook.js` at 38c47737ca8a of 18 September 2021.
  That repository carries no licence, so the file is not copied: one SHA-1
  per substantive line is enough to count which of its lines appear here.
