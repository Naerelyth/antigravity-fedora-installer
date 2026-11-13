"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { hash } = require("../../asar-patches/contracts");
const { readArchive, encodeAsarHeader, patchArchive } = require("../../asar-patches/archive");

test("shared ASAR writer preserves untouched bytes, metadata and replacement order", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "asar-writer-"));
    try {
        const source = path.join(temp, "source.asar"), output = path.join(temp, "output.asar");
        const header = { files: {
            "keep.txt": { size: 4, offset: "0", executable: true },
            dist: { files: { "old.js": { size: 3, offset: "4" } } },
            "external.node": { size: 100, unpacked: true },
            alias: { link: "keep.txt" },
        } };
        const original = Buffer.concat([encodeAsarHeader(header), Buffer.from("keepold")]);
        fs.writeFileSync(source, original);
        const archive = readArchive(source);
        assert.strictEqual(patchArchive(archive, new Map()), archive.buffer);
        const blockSize = 4 * 1024 * 1024;
        const large = Buffer.alloc(blockSize + 3, 42), empty = Buffer.alloc(0);
        fs.writeFileSync(output, patchArchive(archive, new Map([
            ["dist/old.js", large], ["dist/new.js", empty],
        ])));
        const result = readArchive(output), entry = result.header.files.dist.files["old.js"];
        assert.deepEqual(result.extractFile("dist/old.js"), large);
        assert.deepEqual(result.extractFile("dist/new.js"), empty);
        assert.equal(result.extractFile("keep.txt").toString(), "keep");
        assert.equal(entry.offset, "7");
        assert.equal(result.header.files.dist.files["new.js"].offset, String(7 + large.length));
        assert.deepEqual(entry.integrity, {
            algorithm: "SHA256", hash: hash(large), blockSize,
            blocks: [hash(large.subarray(0, blockSize)), hash(large.subarray(blockSize))],
        });
        assert.deepEqual(result.header.files.dist.files["new.js"].integrity.blocks, []);
        for (const name of ["keep.txt", "external.node", "alias"]) {
            assert.deepEqual(result.header.files[name], header.files[name]);
        }
        assert.deepEqual(archive.header, header);
        assert.deepEqual(fs.readFileSync(source), original);
        assert.throws(() => patchArchive(archive, new Map([["missing/file.js", empty]])), /directory contract is missing/);
    }
    finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
