/* Version banner and switcher.

   Quarto port of docs/<lang>/assets/versions.js. The only change is the
   insertion point: Material's .md-content__inner becomes Quarto's
   main.content. Everything else — the address parsing, the legal-page
   retargeting, versions.json — is byte-for-byte the original.

   Published pages live under a version directory that is never touched again,
   so a link keeps meaning what it meant when somebody set it. This adds the
   three things that makes that usable: a note saying which version you are
   reading, a way to reach the same page in another one, and a warning when
   the version is not the current release.

   Everything here is conditional on the address actually carrying a version
   segment. In the help bundled inside the plugin, and in a plain file tree,
   it does nothing at all - which is correct: that copy belongs to the release
   it shipped with.

   versions.json is written by script/gen_versions.py and lives at the site
   root, one directory above the version directories.

   It sits beside gen_langmap.py because that is what puts it on the page:
   pass it as --extra-js and it is inlined into theme/scripts.html. A site
   that vendors the theme gets both, so the banner is the template's rather
   than something each site has to keep its own copy of. */
(function () {
  var LEGAL = /(impressum|privacy|datenschutz)\.html$/;

  /* /0.9.0/en/features.html -> {root: "", version: "0.9.0", rest: "en/features.html"} */
  function locate() {
    var m = /^(.*)\/(latest|\d[\w.+-]*)\/(.*)$/.exec(window.location.pathname);
    if (!m) return null;
    return { root: m[1], version: m[2], rest: m[3] || "index.html" };
  }

  /* The same page in another version: swap one path segment, keep the rest. */
  function samePageIn(here, version) {
    return here.root + "/" + version + "/" + here.rest;
  }

  /* Impressum and privacy policy are never archived: the current ones are the
     only correct ones. Links to them are pulled forward to the latest build,
     which is where the deploy keeps them up to date. */
  function retargetLegal(here) {
    if (here.version === "latest") return;
    var links = document.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      var url;
      try { url = new URL(links[i].getAttribute("href"), window.location.href); }
      catch (e) { continue; }
      if (url.host !== window.location.host) continue;
      if (!LEGAL.test(url.pathname)) continue;
      url.pathname = url.pathname.replace("/" + here.version + "/", "/latest/");
      links[i].setAttribute("href", url.href);
    }
  }

  function element(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }

  function render(here, data) {
    var latest = data.latest;
    var versions = data.versions || [];
    var outdated = here.version !== "latest" && here.version !== latest;

    var box = element("div", "qda-version" + (outdated ? " qda-version--old" : ""));

    if (outdated) {
      var lang = document.documentElement.lang === "de";
      box.appendChild(element("strong", null, lang
        ? "Sie lesen die Dokumentation zu Version " + here.version + "."
        : "You are reading the documentation for version " + here.version + "."));
      var a = element("a", null, lang
        ? "Diese Seite in der aktuellen Fassung " + latest
        : "This page in the current release, " + latest);
      a.setAttribute("href", samePageIn(here, "latest"));
      box.appendChild(document.createTextNode(" "));
      box.appendChild(a);
    } else {
      box.appendChild(element("span", null, "Version " + latest));
    }

    if (versions.length > 1) {
      var select = element("select", "qda-version__pick");
      for (var i = 0; i < versions.length; i++) {
        var opt = element("option", null, versions[i]
          + (versions[i] === latest ? " (latest)" : ""));
        opt.value = versions[i];
        if (versions[i] === here.version
            || (here.version === "latest" && versions[i] === latest)) {
          opt.selected = true;
        }
        select.appendChild(opt);
      }
      select.addEventListener("change", function () {
        window.location.href = samePageIn(here, this.value);
      });
      box.appendChild(select);
    }

    var target = document.querySelector("main.content")
      || document.querySelector("main");
    if (target) target.insertBefore(box, target.firstChild);
  }

  function start() {
    var here = locate();
    if (!here) return;                 /* offline, or an unversioned copy */
    retargetLegal(here);
    if (!window.fetch) return;
    var up = new Array(here.rest.split("/").length).join("../") + "../../";
    fetch(up + "versions.json", { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data) render(here, data); })
      .catch(function () { /* no list: the page is still perfectly readable */ });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
