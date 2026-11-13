"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { createWindowControlsRuntime } = require("../payload/windowControls");
const { encodeAsarHeader, readArchive, refactorAsar, transformHubZoom, transformIpcHandlers, transformUtils, transformPreload } = require("../refactor-asar");

const sourceAsar = process.env.ANTIGRAVITY_TEST_ASAR;
assert.ok(sourceAsar && fs.existsSync(sourceAsar),
    "Set ANTIGRAVITY_TEST_ASAR to a compatible original app.asar, or run npm test from the repository root");

function replaceFixtureEntry(input, output, filename, content) {
    const archive = readArchive(input);
    const header = structuredClone(archive.header);
    const payload = archive.buffer.subarray(8 + archive.headerSize);
    const segments = filename.split("/");
    let directory = header;
    for (const segment of segments.slice(0, -1)) directory = directory.files[segment];
    const bytes = Buffer.from(content);
    directory.files[segments.at(-1)] = { size: bytes.length, offset: String(payload.length) };
    fs.writeFileSync(output, Buffer.concat([encodeAsarHeader(header), payload, bytes]));
}

test("reads newer versions but refuses changed window code without any output", async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-upgrade-"));
    try {
        const newer = path.join(temp, "newer.asar");
        const drifted = path.join(temp, "drifted.asar");
        const patched = path.join(temp, "patched.asar");
        const rejected = path.join(temp, "rejected.asar");
        const metadata = JSON.parse(readArchive(sourceAsar).extractFile("package.json"));
        metadata.version = "99.1.0";
        replaceFixtureEntry(sourceAsar, newer, "package.json", JSON.stringify(metadata));
        assert.equal((await refactorAsar(newer, patched)).version, "99.1.0");
        const drift = readArchive(newer).extractFile("dist/utils.js").toString() + "\n// upstream change\n";
        replaceFixtureEntry(newer, drifted, "dist/utils.js", drift);
        await assert.rejects(refactorAsar(drifted, rejected), /SHA-256 is unsupported/);
        assert.equal(fs.existsSync(rejected), false);
    }
    finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("modal preload transformation is idempotent and rejects drift", () => {
    const source = readArchive(sourceAsar).extractFile("dist/preload.js").toString();
    const patched = transformPreload(source);
    assert.equal(transformPreload(patched), patched);
    assert.throws(() => transformPreload(patched + "\n"));
    assert.match(patched, /setTitleBarOverlay: \(options\) => windowControlsModalSync\(options\)/);
});

test("upgrades only the verified previous modal payload and rejects modified copies", () => {
    const original = readArchive(sourceAsar).extractFile("dist/preload.js").toString();
    const current = transformPreload(original);
    const currentPayload = fs.readFileSync(path.join(__dirname, "../payload/modalThemeSync.js"), "utf8");
    for (const fixture of ["modalThemeSync.previous.js", "modalThemeSync.before-theme-sync.js", "modalThemeSync.before-titlebar-reading.js", "modalThemeSync.before-transparent.js"]) {
        const previousPayload = fs.readFileSync(path.join(__dirname, "fixtures", fixture), "utf8");
        const previous = current.replace(currentPayload, previousPayload);
        assert.notEqual(previous, current);
        assert.equal(transformPreload(previous), current);
        assert.throws(() => transformPreload(previous.replace(previousPayload, previousPayload + "// drift\n")), /SHA-256/);
    }
});

test("rejects loading page color drift without creating or replacing an output", async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-loading-drift-"));
    try {
        const drifted = path.join(temp, "drifted.asar");
        const output = path.join(temp, "output.asar");
        const source = readArchive(sourceAsar).extractFile("dist/loadingOverlay.js").toString();
        const changed = source.replace("getLoadingHtml(foregroundColor, backgroundColor);", "getLoadingHtml(foregroundColor, '#ffffff');");
        assert.notEqual(changed, source);
        replaceFixtureEntry(sourceAsar, drifted, "dist/loadingOverlay.js", changed);
        await assert.rejects(refactorAsar(drifted, output), /loadingOverlay.js contract SHA-256/);
        assert.equal(fs.existsSync(output), false);
        fs.writeFileSync(output, "existing output");
        await assert.rejects(refactorAsar(drifted, output, { force: true }), /loadingOverlay.js contract SHA-256/);
        assert.equal(fs.readFileSync(output, "utf8"), "existing output");
    }
    finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("actual createWindow shares loading colors from construction through renderer handoff on every open", () => {
    const source = transformUtils(readArchive(sourceAsar).extractFile("dist/utils.js").toString());
    for (const themeMode of ["LIGHT", "DARK"]) {
        const nativeTheme = new EventEmitter();
        nativeTheme.shouldUseDarkColors = themeMode === "DARK";
        class Window extends EventEmitter {
            constructor(options) {
                super(); this.options = options; this.calls = [];
                this.views = [];
                this.contentView = { addChildView: view => this.views.push(view), removeChildView() {} };
                this.webContents = new EventEmitter();
                this.webContents.getZoomFactor = () => 1;
                this.webContents.setWindowOpenHandler = () => {};
            }
            setTitleBarOverlay(options) { this.calls.push(options); }
            isDestroyed() { return false; }
            loadURL() { return Promise.resolve(); }
            getContentSize() { return [800, 600]; }
        }
        class LoadingView {
            constructor(options) { this.options = options; this.webContents = Object.assign(new EventEmitter(), { loadURL: url => { this.html = url.startsWith("data:text/html;charset") ? decodeURIComponent(url.split(",").slice(1).join(",")) : url; return Promise.resolve(); }, setWindowOpenHandler() {}, isDestroyed: () => false, close() {}, getZoomFactor: () => 1 }); }
            setBackgroundColor() {}
            setBounds() {}
        }
        const electron = { nativeTheme, BaseWindow: Window, BrowserWindow: Window, WebContentsView: LoadingView, app: { getName: () => "test", isPackaged: true } };
        const loadingExports = {};
        vm.runInNewContext(readArchive(sourceAsar).extractFile("dist/loadingOverlay.js").toString(), {
            exports: loadingExports, require: id => { if (id === "./utils") return { getHubWebContents: win => win.webContents }; assert.equal(id, "electron"); return electron; },
        });
        const runtime = createWindowControlsRuntime(electron, "linux");
        const debugConsole = {};
        vm.runInNewContext(readArchive(sourceAsar).extractFile("dist/debugConsole.js").toString(), {
            exports: debugConsole, require: () => electron,
        });
        const exports = {};
        vm.runInNewContext(source, { exports, __dirname, process: { platform: "linux" }, console,
            require: id => {
                if (id === "electron") return electron;
                if (id === "./windowState") return { resolveInitialWindowState: () => ({ width: 800, height: 600 }), trackWindowState() {} };
                if (id === "./windowControls") return runtime;
                if (id === "./debugConsole") return debugConsole;
                if (id === "path") return path;
                if (id === "fs") return { existsSync: () => true, readFileSync: () => JSON.stringify({ userSettings: { themeMode } }) };
                if (id === "./paths") return { getSettingsPbPath: () => "settings", getAppStoragePath: () => "storage" };
                if (id === "./wsl") return { getActiveWslDistro: () => undefined };
                if (id === "./keybindings") return { registerKeybindings() {} };
                if (id === "./loadingOverlay") return loadingExports;
                return {};
            },
        });
        for (let open = 0; open < 2; open++) {
            const win = exports.createWindow("https://localhost/");
            assert.equal(win.views[1].options.webPreferences.devTools, false);
            const bodyStyle = win.views[2].html.match(/body\s*\{([^}]+)\}/)[1];
            const loadingColor = bodyStyle.match(/background:\s*([^;]+);/)[1];
            const loadingSymbolColor = bodyStyle.match(/(?:^|;)\s*color:\s*([^;]+);/)[1];
            for (const colors of [win.options.titleBarOverlay, ...win.calls]) {
                assert.equal(colors.color, "#00000000");
                assert.equal(colors.symbolColor, loadingSymbolColor);
                assert.equal(win.options.backgroundColor, loadingColor);
            }
            runtime.updateWindowControls(win, { color: "#281646", symbolColor: "#abcdef" });
            assert.equal(win.calls.at(-1).color, "#00000000");
            win.emit("closed");
        }
    }
});

test("transforms the verified Antigravity contracts and is idempotent", () => {
    const archive = readArchive(sourceAsar);
    const utils = archive.extractFile("dist/utils.js").toString("utf8");
    const ipcHandlers = archive.extractFile("dist/ipcHandlers.js").toString("utf8");
    const patchedUtils = transformUtils(utils);
    const patchedIpc = transformIpcHandlers(ipcHandlers);

    assert.match(patchedUtils, /createTitleBarOverlay/);
    assert.match(patchedUtils, /installWindowControls/);
    assert.match(patchedUtils, /setZoomLevel\(level\);\n\s+\(0, windowControls_1\.updateWindowControls\)\(win\)/);
    assert.doesNotMatch(patchedUtils, /height: 30/);
    assert.match(patchedIpc, /resolveHubWindowFromWebContents\)\(_event\.sender\)/);
    assert.match(patchedIpc, /updateWindowControls/);
    assert.equal((patchedIpc.match(/windowControls_1\.updateWindowControls/g) || []).length, 1);
    assert.doesNotMatch(patchedIpc, /if \(win && process\.platform === 'win32'\)/);
    assert.equal(transformUtils(patchedUtils), patchedUtils);
    assert.equal(transformIpcHandlers(patchedIpc), patchedIpc);
});

test("shared Hub zoom refreshes the owning window before persisting, preserves actions and rejects drift", async () => {
    const source = readArchive(sourceAsar).extractFile("dist/hubZoom.js").toString();
    const patched = transformHubZoom(source);
    assert.equal(transformHubZoom(patched), patched);
    assert.throws(() => transformHubZoom(source + "\n"), /SHA-256/);
    const calls = [], win = {}, contents = { getZoomLevel: () => 1, setZoomLevel: value => calls.push(value) };
    const exports = {};
    vm.runInNewContext(patched, { exports, require: id => id === "./utils"
        ? { getHubWebContents: owner => { assert.equal(owner, win); return contents; } }
        : { updateWindowControls: owner => { assert.equal(owner, win); calls.push("refresh"); } } });
    exports.setHubZoomStorageManager({ updateItems: async value => calls.push(value.zoomLevel) });
    for (const [action, expected] of [["in", 1.5], ["out", 0.5], ["reset", 0]]) {
        calls.length = 0; await exports.applyHubWindowZoom(win, action);
        assert.deepEqual(calls, [expected, "refresh", String(expected)]);
    }
});

test("titlebar IPC addresses the sending Hub, excluding guest contents and unrelated windows", async () => {
    const source = transformIpcHandlers(readArchive(sourceAsar).extractFile("dist/ipcHandlers.js").toString());
    const start = source.indexOf("    electron_1.ipcMain.handle('window:set-title-bar-overlay'");
    const end = source.indexOf("    electron_1.ipcMain.handle('window:minimize'", start);
    const hubA = {}, hubB = {}, guest = {}, winA = {}, winB = {}, calls = [];
    let handler;
    vm.runInNewContext(source.slice(start, end), {
        electron_1: { ipcMain: { handle: (_name, fn) => { handler = fn; } } },
        utils_1: { resolveHubWindowFromWebContents: sender => sender === hubA ? winA : winB,
            getHubWebContents: win => win === winA ? hubA : hubB },
        windowControls_1: { updateWindowControls: (win, options) => calls.push([win, options]) },
    });
    const options = { symbolColor: "#abcdef" };
    await handler({ sender: hubB }, options); await handler({ sender: hubA }, options);
    await handler({ sender: guest }, options);
    assert.deepEqual(calls, [[winB, options], [winA, options]]);
});

test("preserves upstream WSL, webview and context-menu code byte-for-byte", () => {
    const archive = readArchive(sourceAsar);
    for (const [file, transform, start, end] of [
        ["utils", transformUtils, "    const wslBadge =", "    const windowOptions ="],
        ["utils", transformUtils, "        webPreferences: {", "\n    };"],
        ["utils", transformUtils, "    // `BaseWindow` does not mirror", "    hubContents.setWindowOpenHandler"],
        ["ipcHandlers", transformIpcHandlers, "function buildContextMenuTemplate", "/**\n * Registers"],
        ["ipcHandlers", transformIpcHandlers, "    let activeContextMenu =", "    // Zoom"],
        ["ipcHandlers", transformIpcHandlers, "    // WSL environment switching", null],
        ["ipcHandlers", transformIpcHandlers, "    // Execute JavaScript inside an Electron <webview>", null],
        ["preload", transformPreload, "    getPathForFile:", "    setTitleBarOverlay:"],
        ["preload", transformPreload, "    showContextMenu:", null],
    ]) {
        const source = archive.extractFile(`dist/${file}.js`).toString();
        const begin = source.indexOf(start);
        const finish = end === null ? source.length : source.indexOf(end, begin);
        assert.ok(begin >= 0 && finish > begin, `${file}: upstream section exists`);
        assert.ok(transform(source).includes(source.slice(begin, finish)), `${file}: upstream section preserved`);
    }
});

test("rejects drifted and partial bundles", () => {
    const archive = readArchive(sourceAsar);
    const utils = archive.extractFile("dist/utils.js").toString("utf8");
    const ipcHandlers = archive.extractFile("dist/ipcHandlers.js").toString("utf8");
    const patchedUtils = transformUtils(utils);
    const patchedIpc = transformIpcHandlers(ipcHandlers);
    assert.throws(() => transformUtils(`${utils}\n`), /contract SHA-256 is unsupported/);
    assert.throws(() => transformUtils(`${patchedUtils}\n`), /contract SHA-256 is unsupported/);
    assert.throws(() => transformIpcHandlers(`${ipcHandlers}\n`), /contract SHA-256 is unsupported/);
    assert.throws(() => transformIpcHandlers(`${patchedIpc}\n`), /contract SHA-256 is unsupported/);
});

test("refuses source overwrite through a symlink alias", async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-asar-alias-"));
    try {
        const source = path.join(temp, "source.asar");
        const alias = path.join(temp, "input-alias.asar");
        fs.copyFileSync(sourceAsar, source);
        fs.symlinkSync(source, alias);
        const before = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
        await assert.rejects(
            refactorAsar(alias, source, { force: true }),
            /symlink or hardlink alias/,
        );
        const after = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
        assert.equal(after, before);
    }
    finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
});

test("ignores a pre-planted legacy temporary-output symlink", async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-asar-temp-link-"));
    try {
        const source = path.join(temp, "source.asar");
        const output = path.join(temp, "output.asar");
        const legacyTemporaryOutput = `${output}.tmp-${process.pid}`;
        fs.copyFileSync(sourceAsar, source);
        fs.symlinkSync(source, legacyTemporaryOutput);
        const before = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
        await refactorAsar(source, output, { force: true });
        const after = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
        assert.equal(after, before);
        assert.deepEqual(readArchive(output).extractFile("dist/windowControls.js"),
            fs.readFileSync(path.join(__dirname, "..", "payload", "windowControls.js")));
        assert.equal(fs.lstatSync(legacyTemporaryOutput).isSymbolicLink(), true);
    }
    finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
});

test("refactor source contains no host-specific output paths", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "refactor-asar.js"), "utf8");
    assert.doesNotMatch(source, /antigravity-asar\.XODl8v/);
    assert.doesNotMatch(source, /Antigravity-x64\/resources\/app\.asar/);
});

test("replaces the ASAR icon, preserves other files, and is byte-idempotent", async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-icon-"));
    try {
        const output = path.join(temp, "patched.asar");
        const again = path.join(temp, "again.asar");
        const icon = path.resolve(__dirname, "../../../assets/icon.png");
        const before = fs.readFileSync(sourceAsar);
        await refactorAsar(sourceAsar, output, { icon });
        const original = readArchive(sourceAsar);
        const patched = readArchive(output);
        assert.deepEqual(patched.extractFile("icon.png"), fs.readFileSync(icon));
        const allowed = new Set(["icon.png", "dist/utils.js", "dist/ipcHandlers.js", "dist/preload.js", "dist/windowControls.js", "dist/hubZoom.js"]);
        function check(directory, prefix = "") {
            for (const [name, entry] of Object.entries(directory.files || {})) {
                const file = prefix + name;
                if (entry.files) check(entry, file + "/");
                else if (!entry.unpacked && !entry.link && !allowed.has(file)) {
                    assert.deepEqual(patched.extractFile(file), original.extractFile(file), file);
                }
            }
        }
        check(original.header);
        fs.chmodSync(output, 0o600);
        await refactorAsar(output, again, { icon });
        assert.deepEqual(fs.readFileSync(again), fs.readFileSync(output));
        assert.equal(fs.statSync(again).mode & 0o777, fs.statSync(output).mode & 0o777);
        assert.deepEqual(fs.readFileSync(sourceAsar), before);
    }
    finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("rejects a non-PNG replacement without producing an output", async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-invalid-icon-"));
    try {
        const output = path.join(temp, "patched.asar");
        await assert.rejects(refactorAsar(sourceAsar, output, { icon: __filename }), /must be a PNG/);
        assert.equal(fs.existsSync(output), false);
    }
    finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
