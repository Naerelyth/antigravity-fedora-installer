#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { readArchive, patchArchive } = require("./archive");
const { hash } = require("./contracts");
const patches = {
    "settings-shadow": require("../settings-shadow/patch"),
    "startup-appearance": require("../startup-appearance/patch"),
};
function applyPatches(input, output, names = Object.keys(patches)) {
    if (!names.length || names.some(name => !Object.hasOwn(patches, name))) throw new Error("Unknown or empty patch selection");
    // New output only: never overwrite input, aliases, or existing build results.
    if (path.resolve(input) === path.resolve(output) || fs.existsSync(output)) throw new Error("Choose a new output path");
    const archive = readArchive(input), files = new Map();
    function walk(directory, prefix = "") {
        for (const [name, entry] of Object.entries(directory.files || {})) {
            const filename = prefix + name;
            if (entry.files) walk(entry, filename + "/");
            else if (!entry.unpacked && !entry.link) files.set(filename, archive.extractFile(filename));
        }
    }
    walk(archive.header);
    const metadata = JSON.parse(files.get("package.json"));
    if (metadata.name !== "antigravity") throw new Error("Unsupported package");
    const changes = new Map();
    for (const name of names) {
        for (const [filename, content] of patches[name](files)) {
            if (!files.get(filename)?.equals(content)) changes.set(filename, content);
            files.set(filename, content);
        }
    }
    const result = patchArchive(archive, changes);
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    const temp = fs.mkdtempSync(path.join(path.dirname(path.resolve(output)), ".appearance-patches-"));
    try {
        const staged = path.join(temp, "app.asar");
        fs.writeFileSync(staged, result);
        const check = readArchive(staged);
        for (const [filename, content] of files) {
            if (!check.extractFile(filename).equals(content)) throw new Error(`Verification failed: ${filename}`);
        }
        // Exclusive creation also rejects dangling symlinks and racing outputs.
        fs.copyFileSync(staged, output, fs.constants.COPYFILE_EXCL);
    }
    finally { fs.rmSync(temp, { recursive: true, force: true }); }
    return { version: metadata.version, patches: names, changedFiles: [...changes.keys()], inputSha256: hash(archive.buffer), outputSha256: hash(result) };
}
if (require.main === module) {
    const [input, output, ...names] = process.argv.slice(2);
    try {
        if (!input || !output) throw new Error("Usage: apply.js INPUT OUTPUT [settings-shadow startup-appearance]");
        console.log(JSON.stringify(applyPatches(input, output, names.length ? names : undefined), null, 2));
    }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { applyPatches };
