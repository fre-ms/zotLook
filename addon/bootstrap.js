/* eslint-disable no-unused-vars */
/* global Services */

// Loaded in dependency order into the shared plugin scope
var SCRIPTS = ["util.js", "sheet.js", "epub.js", "winpreview.js", "zotlook.js"];

var zotLook;
var zotLookUtil;
var zotLookEpub;
var zotLookWinPreview;

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
	zotLook.init({ id, version, rootURI });
	zotLook.addToAllWindows();
}

function onMainWindowLoad({ window }) {
	zotLook.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	zotLook.removeFromWindow(window);
}

function shutdown() {
	log("Shutting down");
	zotLook.removeFromAllWindows();
	zotLook.shutdown();
	zotLook = undefined;
	zotLookEpub = undefined;
	zotLookUtil = undefined;
	zotLookWinPreview = undefined;
}

function uninstall() {
	log("Uninstalled");
}
