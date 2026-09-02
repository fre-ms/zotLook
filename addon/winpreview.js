/* global ChromeUtils, TextEncoder */

/**
 * The Windows preview route.
 *
 * QuickLook (QL-Win) runs a named-pipe server, `QuickLook.App.Pipe.<SID>`,
 * where <SID> is the user's security identifier. One UTF-8 line through it —
 * `QuickLook.App.PipeMessages.Toggle|C:\path\file.pdf|` — shows the preview,
 * the same line again dismisses it, and a different path switches to that
 * file. Both builds answer it: the pipe long predates the Store package, and
 * that package declares `runFullTrust`, so it is not sandboxed away from
 * ordinary processes. The one thing the pipe cannot say is whether QuickLook
 * is running; a connection that fails with ERROR_FILE_NOT_FOUND is how that
 * is learned.
 *
 * The server is fragile in a very particular way. Its reader takes one line
 * per connection and dereferences it unconditionally, so a client that
 * connects and closes without sending a complete line kills the listener
 * with it — silently, and until QuickLook is restarted. That rules out every
 * kind of probing: no "is the pipe there?" connection, no Test-Path-style
 * open. Every connection this module makes writes exactly one full line and
 * then closes, which the server survives indefinitely.
 *
 * Everything here goes through js-ctypes, so no helper binary has to be
 * bundled and no subprocess started: the whole request is a handful of Win32
 * calls. The SID comes from the process token — the detail that a 2019
 * attempt at this integration considered out of reach from a Gecko
 * application, and the reason a PowerShell fallback exists in zotlook.js for
 * the day Gecko drops ctypes.
 */
var zotLookWinPreview = {
	PIPE_PREFIX: "QuickLook.App.Pipe.",

	/** Overridable for tests; the real module exists only inside Gecko. */
	_ctypes() {
		return ChromeUtils.importESModule(
			"resource://gre/modules/ctypes.sys.mjs"
		).ctypes;
	},

	/**
	 * The full path of this user's QuickLook pipe. Throws when ctypes is
	 * unavailable, which is what sends the caller to the fallback.
	 */
	pipePath() {
		return "\\\\.\\pipe\\" + this.PIPE_PREFIX + this._userSid();
	},

	/**
	 * Writes one complete request line into the pipe and closes.
	 *
	 * Throws on failure; when nothing is listening — QuickLook not running,
	 * or not installed — the error carries `quickLookAbsent: true`, so the
	 * caller can name the one failure a user can actually act on.
	 */
	postLine(pipePath, line) {
		const ctypes = this._ctypes();
		const kernel32 = ctypes.open("kernel32.dll");
		try {
			const CreateFileW = kernel32.declare(
				"CreateFileW",
				ctypes.winapi_abi,
				ctypes.voidptr_t, // HANDLE
				ctypes.char16_t.ptr, // lpFileName
				ctypes.uint32_t, // dwDesiredAccess
				ctypes.uint32_t, // dwShareMode
				ctypes.voidptr_t, // lpSecurityAttributes
				ctypes.uint32_t, // dwCreationDisposition
				ctypes.uint32_t, // dwFlagsAndAttributes
				ctypes.voidptr_t // hTemplateFile
			);
			const WaitNamedPipeW = kernel32.declare(
				"WaitNamedPipeW",
				ctypes.winapi_abi,
				ctypes.int32_t,
				ctypes.char16_t.ptr,
				ctypes.uint32_t
			);
			const WriteFile = kernel32.declare(
				"WriteFile",
				ctypes.winapi_abi,
				ctypes.int32_t,
				ctypes.voidptr_t, // hFile
				ctypes.voidptr_t, // lpBuffer
				ctypes.uint32_t, // nNumberOfBytesToWrite
				ctypes.uint32_t.ptr, // lpNumberOfBytesWritten
				ctypes.voidptr_t // lpOverlapped
			);
			const CloseHandle = kernel32.declare(
				"CloseHandle",
				ctypes.winapi_abi,
				ctypes.int32_t,
				ctypes.voidptr_t
			);

			const GENERIC_WRITE = 0x40000000;
			const OPEN_EXISTING = 3;
			const ERROR_FILE_NOT_FOUND = 2;
			const ERROR_PIPE_BUSY = 231;

			let handle;
			for (let attempt = 0; ; attempt++) {
				handle = CreateFileW(
					pipePath,
					GENERIC_WRITE,
					0,
					null,
					OPEN_EXISTING,
					0,
					null
				);
				if (!this._isInvalidHandle(ctypes, handle)) break;
				let code = ctypes.winLastError;
				// The server keeps a single pipe instance, so for the
				// moment it spends dispatching another client's message a
				// connect fails with PIPE_BUSY rather than queueing.
				if (code === ERROR_PIPE_BUSY && attempt < 2) {
					WaitNamedPipeW(pipePath, 2000);
					continue;
				}
				// The flag rides on the error so the caller can tell "QuickLook
				// is not running" from "the write failed" without matching on
				// the message text
				let error = /** @type {Error & {quickLookAbsent?: boolean}} */ (
					new Error(
						"Could not open " + pipePath +
							" (Win32 error " + code + ")"
					));
				if (code === ERROR_FILE_NOT_FOUND) {
					error.quickLookAbsent = true;
				}
				throw error;
			}

			try {
				// One complete line, terminated the way QuickLook's own
				// client terminates it. Sending less than a full line is
				// what kills the server — see the module comment.
				let bytes = new TextEncoder().encode(line + "\r\n");
				let buffer = ctypes.uint8_t.array(bytes.length)();
				for (let i = 0; i < bytes.length; i++) buffer[i] = bytes[i];
				let written = ctypes.uint32_t(0);
				let ok = WriteFile(
					handle,
					ctypes.cast(buffer.address(), ctypes.voidptr_t),
					bytes.length,
					written.address(),
					null
				);
				if (!ok) {
					throw new Error(
						"The pipe write failed (Win32 error " +
							ctypes.winLastError + ")"
					);
				}
			} finally {
				CloseHandle(handle);
			}
		} finally {
			kernel32.close();
		}
	},

	/**
	 * Keeps the keyboard in Zotero while the preview appears.
	 *
	 * QuickLook shows its window without activating it, unless its own
	 * "focus window on open" setting says otherwise — and then whether that
	 * succeeds is Windows' decision, not QuickLook's: a process may take
	 * the foreground only while the user's last input did not go to another
	 * application by keyboard. So a preview opened with Space never took
	 * the focus, and one opened from the context menu, by mouse, could —
	 * after which the next Space went to QuickLook rather than to Zotero,
	 * and no shortcut reached the plugin again until the user clicked back.
	 *
	 * The lock asked for here is exactly the state keyboard input puts the
	 * system into, requested explicitly, so the mouse case behaves like the
	 * keyboard case. Windows lifts it on the user's next click elsewhere or
	 * on Alt, so nothing has to be undone. Only the foreground process may
	 * ask; when Zotero is not it, the call returns false and nothing changes.
	 */
	lockForeground() {
		const ctypes = this._ctypes();
		const user32 = ctypes.open("user32.dll");
		try {
			const LockSetForegroundWindow = user32.declare(
				"LockSetForegroundWindow",
				ctypes.winapi_abi,
				ctypes.int32_t,
				ctypes.uint32_t // uLockCode
			);
			const LSFW_LOCK = 1;
			return !!LockSetForegroundWindow(LSFW_LOCK);
		} finally {
			user32.close();
		}
	},

	/**
	 * CreateFileW reports failure as INVALID_HANDLE_VALUE, which is -1, not
	 * null — a null check alone would read every failure as success.
	 */
	_isInvalidHandle(ctypes, handle) {
		if (!handle || handle.isNull()) return true;
		return String(ctypes.cast(handle, ctypes.intptr_t).value) === "-1";
	},

	/**
	 * The current user's SID as a string, read from the process token.
	 */
	_userSid() {
		const ctypes = this._ctypes();
		const kernel32 = ctypes.open("kernel32.dll");
		const advapi32 = ctypes.open("advapi32.dll");
		try {
			const GetCurrentProcess = kernel32.declare(
				"GetCurrentProcess",
				ctypes.winapi_abi,
				ctypes.voidptr_t
			);
			const CloseHandle = kernel32.declare(
				"CloseHandle",
				ctypes.winapi_abi,
				ctypes.int32_t,
				ctypes.voidptr_t
			);
			const LocalFree = kernel32.declare(
				"LocalFree",
				ctypes.winapi_abi,
				ctypes.voidptr_t,
				ctypes.voidptr_t
			);
			const OpenProcessToken = advapi32.declare(
				"OpenProcessToken",
				ctypes.winapi_abi,
				ctypes.int32_t,
				ctypes.voidptr_t, // ProcessHandle
				ctypes.uint32_t, // DesiredAccess
				ctypes.voidptr_t.ptr // TokenHandle
			);
			const GetTokenInformation = advapi32.declare(
				"GetTokenInformation",
				ctypes.winapi_abi,
				ctypes.int32_t,
				ctypes.voidptr_t, // TokenHandle
				ctypes.uint32_t, // TokenInformationClass
				ctypes.voidptr_t, // TokenInformation
				ctypes.uint32_t, // TokenInformationLength
				ctypes.uint32_t.ptr // ReturnLength
			);
			const ConvertSidToStringSidW = advapi32.declare(
				"ConvertSidToStringSidW",
				ctypes.winapi_abi,
				ctypes.int32_t,
				ctypes.voidptr_t, // Sid
				ctypes.char16_t.ptr.ptr // StringSid
			);

			const TOKEN_QUERY = 0x0008;
			const TokenUser = 1;

			let token = ctypes.voidptr_t();
			if (
				!OpenProcessToken(
					GetCurrentProcess(),
					TOKEN_QUERY,
					token.address()
				)
			) {
				throw new Error(
					"OpenProcessToken failed (Win32 error " +
						ctypes.winLastError + ")"
				);
			}
			try {
				let needed = ctypes.uint32_t(0);
				GetTokenInformation(token, TokenUser, null, 0, needed.address());
				if (!needed.value) {
					throw new Error(
						"GetTokenInformation gave no size (Win32 error " +
							ctypes.winLastError + ")"
					);
				}
				let buffer = ctypes.uint8_t.array(needed.value)();
				if (
					!GetTokenInformation(
						token,
						TokenUser,
						ctypes.cast(buffer.address(), ctypes.voidptr_t),
						needed.value,
						needed.address()
					)
				) {
					throw new Error(
						"GetTokenInformation failed (Win32 error " +
							ctypes.winLastError + ")"
					);
				}
				// TOKEN_USER begins with SID_AND_ATTRIBUTES, whose first
				// field is the PSID — a pointer back into this same buffer.
				let sid = ctypes.cast(
					buffer.address(),
					ctypes.voidptr_t.ptr
				).contents;
				let out = ctypes.char16_t.ptr();
				if (!ConvertSidToStringSidW(sid, out.address())) {
					throw new Error(
						"ConvertSidToStringSidW failed (Win32 error " +
							ctypes.winLastError + ")"
					);
				}
				let text = out.readString();
				LocalFree(ctypes.cast(out, ctypes.voidptr_t));
				return text;
			} finally {
				CloseHandle(token);
			}
		} finally {
			advapi32.close();
			kernel32.close();
		}
	},
};
