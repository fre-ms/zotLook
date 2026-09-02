// Run the plugin out of the working tree instead of out of a package.
//
// The ordinary loop is: build an XPI, copy it into the profile, restart
// Zotero — and, when the version number has not changed, restart it a second
// time, because Zotero keeps the copy it already has for a version it already
// knows. That last part is the one that wastes the most time and is the
// easiest to forget.
//
// Zotero can install a plugin from a directory instead: a file in the
// profile's extensions/ named after the plugin id, holding the path to the
// directory. Then there is nothing to package and nothing to copy, and a
// restart picks up whatever is in addon/ at that moment.
//
// This is not hot reloading. Reloading a plugin inside a running Zotero needs
// either the remote debugging protocol or a plugin that registers an endpoint
// for it, and neither is worth its price here — the measurement that led to
// this script is in the documentation. What it removes is the packaging and
// the double restart, which is most of the waiting.
//
//   node tool/dev.mjs             install from the tree, then watch and restart
//   node tool/dev.mjs --install   only install
//   node tool/dev.mjs --restore   put the packaged copy back
//
//   --profile <path>   a profile other than the one profiles.ini names
//   ZOTERO_BIN         a Zotero other than the one in the usual place

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADDON = path.join(ROOT, "addon");
const ID = JSON.parse(fs.readFileSync(path.join(ADDON, "manifest.json"), "utf8"))
	.applications.zotero.id;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
	const at = argv.indexOf(name);
	return at === -1 ? null : argv[at + 1];
};

/** Where Zotero keeps its profiles, per platform. */
function profileRoot() {
	const home = os.homedir();
	if (process.platform === "darwin") {
		return path.join(home, "Library/Application Support/Zotero");
	}
	if (process.platform === "win32") {
		return path.join(process.env.APPDATA || home, "Zotero/Zotero");
	}
	return path.join(home, ".zotero/zotero");
}

/**
 * The profile to work in: the one profiles.ini marks as default, or the only
 * one there is. Guessing between several would be the wrong kind of helpful.
 */
function findProfile() {
	const given = value("--profile");
	if (given) return path.resolve(given);

	const root = profileRoot();
	const ini = path.join(root, "profiles.ini");
	if (fs.existsSync(ini)) {
		const text = fs.readFileSync(ini, "utf8");
		const blocks = text.split(/\[[^\]]+\]/).slice(1);
		const heads = [...text.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
		let fallback = null;
		for (let i = 0; i < blocks.length; i++) {
			if (!/^Profile/i.test(heads[i])) continue;
			const dir = (blocks[i].match(/^Path=(.+)$/m) || [])[1];
			if (!dir) continue;
			const rel = /^IsRelative=0/m.test(blocks[i]);
			const full = rel ? dir : path.join(root, dir);
			if (/^Default=1/m.test(blocks[i])) return full;
			fallback ||= full;
		}
		if (fallback) return fallback;
	}

	const dir = path.join(root, "Profiles");
	const found = fs.existsSync(dir)
		? fs.readdirSync(dir).map((d) => path.join(dir, d))
			.filter((d) => fs.statSync(d).isDirectory())
		: [];
	if (found.length === 1) return found[0];
	die(found.length
		? `Several profiles under ${dir} — name one with --profile`
		: `No Zotero profile found under ${root} — name one with --profile`);
}

function die(message) {
	console.error("dev: " + message);
	process.exit(1);
}

function zoteroBinary() {
	if (process.env.ZOTERO_BIN) return process.env.ZOTERO_BIN;
	if (process.platform === "darwin") return "/Applications/Zotero.app/Contents/MacOS/zotero";
	if (process.platform === "win32") {
		return path.join(process.env.ProgramFiles || "C:\\Program Files",
			"Zotero/zotero.exe");
	}
	return "zotero";
}

/**
 * Point the profile at the working tree.
 *
 * Three things, and the third is the one that is easy to miss: a plugin that
 * was disabled once stays disabled in extensions.json however it is
 * installed, so an install that looks right shows no plugin at all.
 */
function install(profile) {
	const extensions = path.join(profile, "extensions");
	fs.mkdirSync(extensions, { recursive: true });

	const xpi = path.join(extensions, ID + ".xpi");
	if (fs.existsSync(xpi)) {
		fs.renameSync(xpi, xpi + ".packaged");
		console.log("dev: packaged copy set aside as " + path.basename(xpi) + ".packaged");
	}

	fs.writeFileSync(path.join(extensions, ID), ADDON, "utf8");
	console.log("dev: " + ID + " -> " + ADDON);

	const json = path.join(profile, "extensions.json");
	if (fs.existsSync(json)) {
		const data = JSON.parse(fs.readFileSync(json, "utf8"));
		let changed = false;
		for (const addon of data.addons || []) {
			if (addon.id !== ID) continue;
			if (addon.active === false || addon.userDisabled === true) {
				addon.active = true;
				addon.userDisabled = false;
				changed = true;
			}
		}
		if (changed) {
			fs.writeFileSync(json, JSON.stringify(data), "utf8");
			console.log("dev: re-enabled in extensions.json");
		}
	}
}

/** Undo it: the proxy file goes, the package comes back. */
function restore(profile) {
	const extensions = path.join(profile, "extensions");
	const proxy = path.join(extensions, ID);
	if (fs.existsSync(proxy)) {
		fs.rmSync(proxy);
		console.log("dev: proxy file removed");
	}
	const kept = path.join(extensions, ID + ".xpi.packaged");
	if (fs.existsSync(kept)) {
		fs.renameSync(kept, path.join(extensions, ID + ".xpi"));
		console.log("dev: packaged copy put back");
	} else {
		console.log("dev: no packaged copy was set aside — run build.sh to make one");
	}
}

/**
 * --purgecaches matters. Zotero caches compiled scripts across starts, and
 * bootstrap.js is cached by Zotero itself rather than by the plugin, so
 * without it a restart can run yesterday's loader against today's modules.
 */
function restart(profile) {
	if (process.platform === "darwin") {
		spawnSync("osascript", ["-e", 'quit app "Zotero"']);
	} else if (process.platform === "win32") {
		spawnSync("taskkill", ["/im", "zotero.exe"]);
	} else {
		spawnSync("pkill", ["-x", "zotero"]);
	}

	const child = spawn(zoteroBinary(),
		["--purgecaches", "-profile", profile],
		{ detached: true, stdio: "ignore" });
	child.unref();
	console.log("dev: Zotero restarted " + new Date().toLocaleTimeString());
}

function watch(profile) {
	console.log("dev: watching " + path.relative(ROOT, ADDON) + " — Ctrl+C to stop");
	let timer = null;
	fs.watch(ADDON, { recursive: true }, (_event, name) => {
		if (name && /\.(sw[px]|tmp)$|~$/.test(name)) return;
		clearTimeout(timer);
		// One restart for a burst of writes: an editor saving a file touches
		// it more than once, and a rebuild of the docs touches many
		timer = setTimeout(() => restart(profile), 400);
	});
}

const profile = findProfile();
if (!fs.existsSync(profile)) die("no such profile: " + profile);
console.log("dev: profile " + profile);

if (flag("--restore")) {
	restore(profile);
} else {
	install(profile);
	if (!flag("--install")) {
		restart(profile);
		watch(profile);
	}
}
