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
//   ZOTERO_QUIT        a command that closes Zotero, instead of the usual one
//   ZOTERO_PROBE       a command that exits 0 while Zotero runs, likewise
//   ZOTLOOK_ADDON      the directory to install and watch, instead of addon/

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// ZOTLOOK_ADDON is for the tests: they exercise the watch by writing into
// the directory it watches, and that must not be the real addon/ — a running
// loop would see the writes and restart the developer's Zotero, which is how
// this was noticed. Everything else takes the tree as it is.
const ADDON = process.env.ZOTLOOK_ADDON
	? path.resolve(process.env.ZOTLOOK_ADDON)
	: path.join(ROOT, "addon");
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
/**
 * Whether a Zotero is up. Worth knowing before install or restore: both act
 * on files Zotero reads at startup and on a preference it rewrites as it
 * exits, so doing either underneath a running one looks like it worked and
 * changes nothing.
 */
function zoteroRunning() {
	// ZOTERO_PROBE: a command whose exit status 0 means "still running", so
	// the wait below can be driven in a test without a Zotero to wait for
	if (process.env.ZOTERO_PROBE) {
		return spawnSync(process.env.ZOTERO_PROBE, { shell: true }).status === 0;
	}
	const probe = process.platform === "win32"
		? spawnSync("tasklist", ["/fi", "imagename eq zotero.exe"], { encoding: "utf8" })
		: spawnSync("pgrep", ["-x", "zotero"], { encoding: "utf8" });
	return process.platform === "win32"
		? /zotero\.exe/i.test(probe.stdout || "")
		: probe.status === 0;
}

/**
 * The Quick Look helper has to be in addon/ for a tree install to preview
 * the way a package does.
 *
 * build.sh compiles it into addon/ and removes it again once the XPI holds
 * it, so a checkout never carries one. Run from the tree without it, the
 * plugin falls back to qlmanage — and qlmanage's panel neither hands the
 * contact sheet's links to the system nor closes on the handoff. The preview
 * looks right and the links do nothing, which is how this was found.
 *
 * Rebuilt when the Swift source is newer than the binary, so an edit to the
 * helper reaches the loop like an edit to anything else.
 */
function ensureHelper() {
	if (process.platform !== "darwin") return;
	const binary = path.join(ADDON, "qlpreview");
	const source = path.join(ROOT, "native", "qlpreview.swift");
	const stale = !fs.existsSync(binary)
		|| fs.statSync(binary).mtimeMs < fs.statSync(source).mtimeMs;
	if (!stale) return;

	console.log("dev: building the Quick Look helper…");
	const built = spawnSync("sh", [path.join(ROOT, "build.sh"), "--helper"],
		{ cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
	if (built.status !== 0 || !fs.existsSync(binary)) {
		console.log("dev: WARNING — no Quick Look helper. Previews will fall back "
			+ "to qlmanage, where the contact sheet's links do nothing and the "
			+ "panel does not close on the handoff. Install the Xcode Command "
			+ "Line Tools and run again.");
	}
}

/** Where the packaged copy waits: the profile root, which Zotero leaves be. */
function kept(profile) {
	return path.join(profile, ID + ".xpi.packaged");
}

function install(profile) {
	ensureHelper();
	const extensions = path.join(profile, "extensions");
	fs.mkdirSync(extensions, { recursive: true });

	// Set aside one level up, in the profile root. Not in extensions/: Zotero
	// owns that directory and sweeps out what it does not recognise, so a
	// package parked there is gone by the next start — which is exactly what
	// happened the first time this was tried, and --restore then had nothing
	// to put back.
	const xpi = path.join(extensions, ID + ".xpi");
	if (fs.existsSync(xpi)) {
		fs.renameSync(xpi, kept(profile));
		console.log("dev: packaged copy set aside in the profile root");
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
	const aside = kept(profile);
	if (fs.existsSync(aside)) {
		fs.renameSync(aside, path.join(extensions, ID + ".xpi"));
		console.log("dev: packaged copy put back");
	} else {
		console.log("dev: no packaged copy was set aside — run build.sh to make one");
	}
	// So the next start notices that extensions/ has changed back
	forceRescan(profile);
}

/**
 * --purgecaches matters. Zotero caches compiled scripts across starts, and
 * bootstrap.js is cached by Zotero itself rather than by the plugin, so
 * without it a restart can run yesterday's loader against today's modules.
 */
/**
 * Make the next start look at extensions/ again.
 *
 * Without this the whole thing quietly does nothing, which is how it was
 * first shipped: Zotero records what it found last time in extensions.json
 * and only rescans the directory when the application it belongs to has
 * changed, which it tells by extensions.lastAppBuildId. A proxy file put
 * beside an entry that still names the packaged copy is simply not seen —
 * measured, with a Zotero that started twice and loaded nothing, and then
 * loaded the plugin from the tree the moment this pref was cleared.
 *
 * The value heals itself: Zotero writes the real build id back on the start
 * that follows. autoDisableScopes goes with it because a plugin found in the
 * profile directory is treated as side-loaded, and side-loaded plugins are
 * disabled on sight unless it is off.
 *
 * Only while Zotero is closed — it rewrites prefs.js as it exits, over
 * anything written here.
 */
function forceRescan(profile) {
	const file = path.join(profile, "prefs.js");
	if (!fs.existsSync(file)) return;
	let text = fs.readFileSync(file, "utf8");

	text = text.replace(/user_pref\("extensions\.lastAppBuildId", "[^"]*"\);/,
		'user_pref("extensions.lastAppBuildId", "0");');
	if (!/user_pref\("extensions\.autoDisableScopes"/.test(text)) {
		text = text.replace(/\n*$/, "\n")
			+ 'user_pref("extensions.autoDisableScopes", 0);\n';
	}
	fs.writeFileSync(file, text, "utf8");
}

function restart(profile) {
	// ZOTERO_QUIT is how this is testable at all: a test that let the real
	// quit run would close the Zotero of whoever ran the suite. It is also
	// the escape hatch for a desktop where the ordinary way does not work.
	if (process.env.ZOTERO_QUIT) {
		spawnSync(process.env.ZOTERO_QUIT, { shell: true });
	} else if (process.platform === "darwin") {
		// Asks rather than kills, so Zotero closes its database properly
		spawnSync("osascript", ["-e", 'quit app "Zotero"']);
	} else if (process.platform === "win32") {
		spawnSync("taskkill", ["/im", "zotero.exe"]);
	} else {
		spawnSync("pkill", ["-x", "zotero"]);
	}

	// Then wait until it is gone. Asking is asynchronous — Zotero saves its
	// state and closes its database before it exits — and `open -a` on an
	// application that is still running does not start a second one: it
	// activates the first, drops the arguments, and the pending quit is
	// cancelled by the activation. The loop then reports a restart that never
	// happened, and Zotero runs on with yesterday's tree. Found by comparing
	// the process's start time with the loop's own log line.
	const deadline = Date.now() + 30000;
	while (zoteroRunning() && Date.now() < deadline) {
		spawnSync("sleep", ["0.5"]);
	}
	if (zoteroRunning()) {
		console.log("dev: Zotero did not close in 30 s — forcing it");
		if (process.platform === "win32") {
			spawnSync("taskkill", ["/f", "/im", "zotero.exe"]);
		} else {
			spawnSync("pkill", ["-9", "-x", "zotero"]);
		}
		spawnSync("sleep", ["1"]);
	}

	forceRescan(profile);

	// Through the launcher on macOS, not by running the executable.
	//
	// A process started straight from the binary inherits the terminal's
	// context, and so does everything it spawns — including the Quick Look
	// helper. What that helper does when a page of the contact sheet is
	// clicked is ask the system to open a zotero: URL, and asking the system
	// for anything is what a process outside the launcher's world is worst
	// at. Zotero itself does not care; the handoff does.
	//
	// So the loop starts Zotero the way a person starts it, and the flags go
	// through --args. ZOTERO_BIN still runs what it names directly: someone
	// who points it at a build somewhere unusual means that build.
	const args = ["--purgecaches", "-profile", profile];
	const child = process.platform === "darwin" && !process.env.ZOTERO_BIN
		? spawn("open", ["-a", "Zotero", "--args", ...args],
			{ detached: true, stdio: "ignore" })
		: spawn(zoteroBinary(), args, { detached: true, stdio: "ignore" });
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

// The watch quits Zotero itself; the two one-shot commands do not, and under
// a running one they are quietly ineffective — the profile is read at
// startup, and prefs.js is rewritten as Zotero exits, over the flag that
// makes the next start look again.
if ((flag("--restore") || flag("--install")) && zoteroRunning()) {
	console.log("dev: Zotero is running — close it, or this takes effect on "
		+ "the start after next and the rescan flag is overwritten meanwhile");
}

if (flag("--restore")) {
	restore(profile);
} else {
	install(profile);
	if (!flag("--install")) {
		restart(profile);
		watch(profile);
	}
}
