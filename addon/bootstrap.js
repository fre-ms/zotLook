/* eslint-disable no-unused-vars */
/* global Services */

// Loaded in dependency order into the shared plugin scope
var SCRIPTS = ["util.js", "sheet.js", "epub.js", "zotlook.js"];

var ZotLook;
var ZotLookUtil;
var ZotLookEpub;

function log(msg) {
	Zotero.debug("zotLook: " + msg);
}

function install() {
	log("Installed");
}

async function startup({ id, version, rootURI }) {
	log("Starting v" + version);

	// ignoreCache matters: without it the script loader can hand back the
	// compiled copy from a previous install of the same version, so a fresh
	// bootstrap.js ends up running against stale modules. Zotero loads
	// bootstrap.js itself the same way, for the same reason.
	for (let script of SCRIPTS) {
		Services.scriptloader.loadSubScriptWithOptions(rootURI + script, {
			target: globalThis,
			ignoreCache: true,
		});
	}
	ZotLook.init({ id, version, rootURI });
	ZotLook.addToAllWindows();
}

function onMainWindowLoad({ window }) {
	ZotLook.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	ZotLook.removeFromWindow(window);
}

function shutdown() {
	log("Shutting down");
	ZotLook.removeFromAllWindows();
	ZotLook.shutdown();
	ZotLook = undefined;
	ZotLookEpub = undefined;
	ZotLookUtil = undefined;
}

function uninstall() {
	log("Uninstalled");
}
