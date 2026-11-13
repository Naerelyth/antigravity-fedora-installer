#!/usr/bin/env node
"use strict";

const { hash: sha256Content } = require("../asar-patches/contracts");
const { readArchive, encodeAsarHeader, patchArchive } = require("../asar-patches/archive");
const fs = require("node:fs");
const path = require("node:path");

const TARGET_HASHES = {
    utils: {
        current: "0c4d101773515c827dd91c3b60bdcc4a04591758bb9b4280c46350987c7d17dd",
        patched: "546815edb915314537c001627edce030ad2a5b12f9d609e6ecc71dfdf0effe7f",
    },
    ipcHandlers: {
        current: "e45b442a3e8a55e521ead048bb858a1bbe8c282e1a5f9d7fab9366b843a44ead",
        patched: "f9bc05c14a2a671794492e1a7f3212cb564de2cac96e2464fc463d64af0a64b9",
    },
};
const WINDOW_CONTROLS_SHA256 = "9f1ca009ede6f1ebbe232eae094d149bf81402d68b7051b512d8762c5a21d73e";
const BEFORE_SHARED_BACKGROUND_SHA256 = "d04bf40880896960bb9180e3e14845de43650f49b7b921bc5c75c2a31fe5b25e";
const BEFORE_HEIGHT_FIX_SHA256 = "fe202eb8bbf87bd94de98aa04cb24a5a43c8bf5937e5b3b75e08a131d0aa3c52";
const PREVIOUS_WINDOW_CONTROLS_SHA256 = "de2b464a7400f5271fd91b2c59d844f489933cc3f3444035c98a3e2d21837274";
const LOADING_THEME_UTILS_SHA256 = "82f7089e178ae7350f69de08876e5cef014efc2784f44971be06f9291cb75aea";
const LOADING_OVERLAY_SHA256 = "a4b2cc2ae9e73c81fcec511dee72d60f0d8cb1ba1f02a6170896bb595267bb1f";
const MODAL_SYNC_SHA256 = "187a2b7d9d1d2edb596431b6f5925d64596d8c1eecdf6371bb41d185f3dcff39";
const BEFORE_TRANSPARENT_SYNC_SHA256 = "b551230683ed152a3ae4ed718d073002dfe416fae3a18c46cbd2f11cc40dcf94";
const BEFORE_TITLEBAR_READING_SHA256 = "1f75006c28b26d5d5f81f6c96d5194fd27d6989690b0300ba1992efdb4ad15ce";
const BEFORE_THEME_SYNC_SHA256 = "87af87239639899d30b464cedf6ebee5ced5a02d6de4a8946f1f0d92a8b3a40b";
const PREVIOUS_MODAL_SYNC_SHA256 = "8d273824737c9a6c6ffad5fc343ba60e49eb6931fb2457d333edae74f6997e2d";

function verifyLoadingOverlay(archive) {
    if (sha256Content(archive.extractFile("dist/loadingOverlay.js")) !== LOADING_OVERLAY_SHA256) {
        throw new Error("dist/loadingOverlay.js contract SHA-256 is unsupported");
    }
}

function countOccurrences(source, needle) {
    return source.split(needle).length - 1;
}

function transformPreload(source) {
    const originalHash = "8457dc1fe5fa34ff138e041923a66b852e0a6fb1623b9aedcfb80f15dd98e9d7";
    const modalSource = fs.readFileSync(path.join(__dirname, "payload", "modalThemeSync.js"), "utf8");
    if (sha256Content(modalSource) !== MODAL_SYNC_SHA256) throw new Error("Unsupported modal sync payload SHA-256");
    const bridge = "\nconst windowControlsModalSync = installModalThemeSync(options => electron_1.ipcRenderer.invoke('window:set-title-bar-overlay', options));\n";
    const injection = `\n${modalSource}${bridge}`;
    const current = "setTitleBarOverlay: (options) => electron_1.ipcRenderer.invoke('window:set-title-bar-overlay', options),";
    const patched = "setTitleBarOverlay: (options) => windowControlsModalSync(options),";
    if (sha256Content(source) === originalHash) {
        return replaceExactly(replaceExactly(source, "const electronNativeAPI = {", injection + "const electronNativeAPI = {", "preload modal observer"), current, patched, "preload theme bridge");
    }
    const prefix = '\n"use strict";\n\n// Embedded in the sandboxed preload; no Node APIs or page-world injection.\n';
    const start = source.indexOf(prefix);
    const end = source.indexOf(bridge, start);
    if (countOccurrences(source, prefix) !== 1 || countOccurrences(source, bridge) !== 1 || end < start) {
        throw new Error("Unsupported preload modal observer structure");
    }
    const existingHash = sha256Content(source.slice(start + 1, end));
    if (![MODAL_SYNC_SHA256, BEFORE_TRANSPARENT_SYNC_SHA256, BEFORE_TITLEBAR_READING_SHA256, BEFORE_THEME_SYNC_SHA256, PREVIOUS_MODAL_SYNC_SHA256].includes(existingHash)) {
        throw new Error("Unsupported existing modal sync SHA-256");
    }
    const existingInjection = source.slice(start, end + bridge.length);
    const restored = replaceExactly(replaceExactly(source, existingInjection, "", "existing modal observer"), patched, current, "existing theme bridge");
    if (sha256Content(restored) !== originalHash) throw new Error("Unsupported preload SHA-256");
    return replaceExactly(source, existingInjection, injection, "modal observer upgrade");
}

function classifyTarget(source, hashes, description) {
    const hash = sha256Content(source);
    if (hash === hashes.current) {
        return "current";
    }
    if (hash === hashes.patched) {
        return "patched";
    }
    throw new Error(`${description} contract SHA-256 is unsupported: ${hash}`);
}

function replaceExactly(source, current, replacement, description) {
    const count = countOccurrences(source, current);
    if (count !== 1) {
        throw new Error(`Expected exactly one ${description} contract, found ${count}`);
    }
    return source.replace(current, replacement);
}

function replaceCountExactly(source, current, replacement, expectedCount, description) {
    const count = countOccurrences(source, current);
    if (count !== expectedCount) {
        throw new Error(`Expected exactly ${expectedCount} ${description} contracts, found ${count}`);
    }
    return source.split(current).join(replacement);
}

function transformUtils(source) {
    if (sha256Content(source) === LOADING_THEME_UTILS_SHA256) return source;
    let result = transformBaseUtils(source);
    result = replaceExactly(result,
        "createTitleBarOverlay)({ symbolColor: foregroundColor })",
        "createTitleBarOverlay)({ color: backgroundColor, symbolColor: foregroundColor })",
        "initial loading overlay colors");
    result = replaceExactly(result,
        "installWindowControls)(win, {\n",
        "installWindowControls)(win, {\n        color: backgroundColor,\n        symbolColor: foregroundColor,\n",
        "loading colors retained by controller");
    if (sha256Content(result) !== LOADING_THEME_UTILS_SHA256) {
        throw new Error("Loading-theme utils hash mismatch");
    }
    return result;
}

function transformBaseUtils(source) {
    if (classifyTarget(source, TARGET_HASHES.utils, "dist/utils.js") === "patched") {
        return source;
    }

    let result = replaceExactly(
        source,
        'const loadingOverlay_1 = require("./loadingOverlay");',
        'const loadingOverlay_1 = require("./loadingOverlay");\nconst windowControls_1 = require("./windowControls");',
        "utils import",
    );
    result = replaceExactly(
        result,
        "        titleBarOverlay: isMacOS()\n            ? false\n            : {\n                color: backgroundColor,\n                symbolColor: foregroundColor,\n                height: 30,\n            },",
        "        titleBarOverlay: isMacOS()\n            ? false\n            : (0, windowControls_1.createTitleBarOverlay)({ symbolColor: foregroundColor }),",
        "BrowserWindow titleBarOverlay",
    );
    result = replaceExactly(
        result,
        "    hubWindows.add(win);",
        "    (0, windowControls_1.installWindowControls)(win, {\n        resolveDefaultSymbolColor: () => getThemeMode().toUpperCase().includes('LIGHT') ? '#1f1f1f' : '#ffffff',\n        shouldFollowSystemTheme: () => {\n            try {\n                const config = JSON.parse(fs.readFileSync((0, paths_1.getSettingsPbPath)(), 'utf-8'));\n                return config?.userSettings?.themeMode?.includes('INHERIT') === true;\n            }\n            catch {\n                return false;\n            }\n        },\n    });\n    hubWindows.add(win);",
        "window-controls installation",
    );
    result = replaceExactly(
        result,
        "                    hubContents.setZoomLevel(level);\n                    isRestoringZoom = false;",
        "                    hubContents.setZoomLevel(level);\n                    (0, windowControls_1.updateWindowControls)(win);\n                    isRestoringZoom = false;",
        "stored zoom overlay refresh",
    );
    if (sha256Content(result) !== TARGET_HASHES.utils.patched) {
        throw new Error("Internal error: transformed dist/utils.js does not match its locked SHA-256");
    }
    return result;
}

function transformIpcHandlers(source) {
    if (classifyTarget(source, TARGET_HASHES.ipcHandlers, "dist/ipcHandlers.js") === "patched") {
        return source;
    }

    let result = replaceExactly(
        source,
        'const tray_1 = require("./tray");',
        'const tray_1 = require("./tray");\nconst windowControls_1 = require("./windowControls");',
        "IPC import",
    );
    result = replaceExactly(
        result,
        "    electron_1.ipcMain.handle('window:set-title-bar-overlay', async (_event, options) => {\n        const win = getTargetHubWindow();\n        if (win && process.platform === 'win32') {\n            win.setTitleBarOverlay({\n                color: options.color,\n                symbolColor: options.symbolColor,\n                height: 30,\n            });\n        }\n    });",
        "    electron_1.ipcMain.handle('window:set-title-bar-overlay', async (_event, options) => {\n        const win = (0, utils_1.resolveHubWindowFromWebContents)(_event.sender);\n        if (win && (0, utils_1.getHubWebContents)(win) === _event.sender) {\n            (0, windowControls_1.updateWindowControls)(win, options);\n        }\n    });",
        "titlebar IPC handler",
    );
    if (sha256Content(result) !== TARGET_HASHES.ipcHandlers.patched) {
        throw new Error("Internal error: transformed dist/ipcHandlers.js does not match its locked SHA-256");
    }
    return result;
}

function transformHubZoom(source) {
    const { locked, replaceOnce } = require("../asar-patches/contracts");
    return locked(Buffer.from(source), "32a51e8801c984dc5b841777f9e276b4e3a22334f782c09c6b098b0330081d96", "28616c79dbdd3f3189b479cc6b20ba08e63a584b5e62d8e815d51ef5f55ceb3f", text => {
        text = replaceOnce(text, 'const utils_1 = require("./utils");', 'const utils_1 = require("./utils");\nconst windowControls_1 = require("./windowControls");');
        return replaceOnce(text, '    hubContents.setZoomLevel?.(newLevel);', '    hubContents.setZoomLevel?.(newLevel);\n    (0, windowControls_1.updateWindowControls)(win);');
    }).toString();
}

function verifyArchive(archivePath, icon) {
    const archive = readArchive(archivePath);
    verifyLoadingOverlay(archive);
    const zoom = archive.extractFile("dist/hubZoom.js").toString();
    if (transformHubZoom(zoom) !== zoom) throw new Error("Missing zoom controls sync");
    if (icon && !archive.extractFile("icon.png").equals(icon)) {
        throw new Error("Patched ASAR icon verification failed");
    }
    const preload = archive.extractFile("dist/preload.js").toString("utf8");
    if (transformPreload(preload) !== preload) throw new Error("Missing modal theme sync");
    const packageJson = JSON.parse(archive.extractFile("package.json").toString("utf8"));
    const utils = archive.extractFile("dist/utils.js").toString("utf8");
    const ipcHandlers = archive.extractFile("dist/ipcHandlers.js").toString("utf8");
    const windowControls = archive.extractFile("dist/windowControls.js").toString("utf8");
    if (packageJson.name !== "antigravity"
        || sha256Content(utils) !== LOADING_THEME_UTILS_SHA256
        || sha256Content(ipcHandlers) !== TARGET_HASHES.ipcHandlers.patched
        || sha256Content(windowControls) !== WINDOW_CONTROLS_SHA256) {
        throw new Error("Patched ASAR verification failed");
    }
    return packageJson.version;
}

async function refactorAsar(inputPath, outputPath, options = {}) {
    const input = path.resolve(inputPath);
    const output = path.resolve(outputPath);
    if (input === output) {
        throw new Error("Refusing to overwrite the source ASAR; choose a separate output path");
    }
    if (!fs.existsSync(input)) {
        throw new Error(`Input ASAR does not exist: ${input}`);
    }
    const inputStat = fs.statSync(input);
    const icon = options.icon ? fs.readFileSync(path.resolve(options.icon)) : null;
    if (icon && (icon.length < 24 || !icon.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))) {
        throw new Error("Replacement icon must be a PNG file");
    }
    if (fs.existsSync(output)) {
        const outputStat = fs.statSync(output);
        if (inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino) {
            throw new Error("Refusing to overwrite the source ASAR through a symlink or hardlink alias");
        }
    }
    if (fs.existsSync(output) && !options.force) {
        throw new Error(`Output already exists: ${output} (pass --force to replace it)`);
    }

    fs.mkdirSync(path.dirname(output), { recursive: true });
    const temporaryDirectory = fs.mkdtempSync(path.join(path.dirname(output), ".antigravity-window-controls-"));
    const temporaryOutput = path.join(temporaryDirectory, "app.asar");
    try {
        const sourceArchive = readArchive(input);
        verifyLoadingOverlay(sourceArchive);
        const iconUnchanged = !icon || sourceArchive.extractFile("icon.png").equals(icon);
        const packageJson = JSON.parse(sourceArchive.extractFile("package.json").toString("utf8"));
        if (packageJson.name !== "antigravity" || typeof packageJson.version !== "string" || !/^\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
            throw new Error(`Unsupported Antigravity metadata: ${packageJson.name}@${packageJson.version}`);
        }
        const preload = sourceArchive.extractFile("dist/preload.js").toString("utf8");
        const transformedPreload = transformPreload(preload);
        const utils = sourceArchive.extractFile("dist/utils.js").toString("utf8");
        const ipcHandlers = sourceArchive.extractFile("dist/ipcHandlers.js").toString("utf8");
        const transformedUtils = transformUtils(utils);
        const transformedIpcHandlers = transformIpcHandlers(ipcHandlers);
        const hubZoom = sourceArchive.extractFile("dist/hubZoom.js").toString();
        const transformedHubZoom = transformHubZoom(hubZoom);
        const utilsArePatched = sha256Content(utils) !== TARGET_HASHES.utils.current;
        const ipcHandlersArePatched = transformedIpcHandlers === ipcHandlers;
        if (utilsArePatched !== ipcHandlersArePatched || utilsArePatched !== (hubZoom === transformedHubZoom)) {
            throw new Error("Refusing a mixed current/patched window-controls contract");
        }
        const isAlreadyRefactored = utilsArePatched && ipcHandlersArePatched;
        let unchanged = false;
        if (isAlreadyRefactored) {
            const payloadHash = sha256Content(sourceArchive.extractFile("dist/windowControls.js"));
            if (![WINDOW_CONTROLS_SHA256, BEFORE_SHARED_BACKGROUND_SHA256, BEFORE_HEIGHT_FIX_SHA256, PREVIOUS_WINDOW_CONTROLS_SHA256].includes(payloadHash)) {
                throw new Error(`dist/windowControls.js contract SHA-256 is unsupported: ${payloadHash}`);
            }
            unchanged = payloadHash === WINDOW_CONTROLS_SHA256 && transformedUtils === utils
                && transformedPreload === preload && iconUnchanged;
        }
        else {
            try {
                sourceArchive.extractFile("dist/windowControls.js");
                throw new Error("Current target files unexpectedly contain a windowControls payload");
            }
            catch (error) {
                if (!String(error.message).startsWith("ASAR entry not found:")) {
                    throw error;
                }
            }
        }
        const replacements = new Map();
        if (!unchanged) {
            const payload = fs.readFileSync(path.join(__dirname, "payload", "windowControls.js"));
            const payloadHash = sha256Content(payload);
            if (payloadHash !== WINDOW_CONTROLS_SHA256) {
                throw new Error(`Local windowControls payload SHA-256 is unsupported: ${payloadHash}`);
            }
            replacements.set("dist/preload.js", Buffer.from(transformedPreload));
            replacements.set("dist/utils.js", Buffer.from(transformedUtils));
            replacements.set("dist/ipcHandlers.js", Buffer.from(transformedIpcHandlers));
            replacements.set("dist/windowControls.js", payload);
            replacements.set("dist/hubZoom.js", Buffer.from(transformedHubZoom));
            if (icon) replacements.set("icon.png", icon);
        }
        // Keep the no-op copy's file mode as well as its byte identity.
        if (unchanged) fs.copyFileSync(input, temporaryOutput);
        else fs.writeFileSync(temporaryOutput, patchArchive(sourceArchive, replacements));
        verifyArchive(temporaryOutput, icon);
        if (fs.existsSync(output)) {
            fs.unlinkSync(output);
        }
        fs.renameSync(temporaryOutput, output);
        return {
            input,
            inputSha256: sha256Content(sourceArchive.buffer),
            output,
            outputSha256: sha256Content(fs.readFileSync(output)),
            version: packageJson.version,
        };
    }
    finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
}

async function main(argv) {
    let force = false;
    let icon;
    const positional = [];
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === "--force") force = true;
        else if (arg === "--icon") {
            icon = argv[++index];
            if (!icon || icon.startsWith("--")) throw new Error("--icon requires a PNG path");
        }
        else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
        else positional.push(arg);
    }
    if (positional.length < 1 || positional.length > 2) {
        console.error("Usage: node refactor-asar.js <input.asar> [output.asar] [--icon icon.png] [--force]");
        process.exitCode = 2;
        return;
    }
    const input = positional[0];
    const output = positional[1] || path.join(__dirname, "build", "app.asar");
    const result = await refactorAsar(input, output, { force, icon });
    console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
    main(process.argv.slice(2)).catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = {
    transformHubZoom,
    encodeAsarHeader,
    readArchive,
    refactorAsar,
    transformIpcHandlers,
    transformUtils,
    transformPreload,
};
