"use strict";
const crypto = require("node:crypto");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function replaceOnce(source, from, to) {
    if (source.split(from).length !== 2) throw new Error("Patch anchor drift");
    return source.replace(from, to);
}
function locked(source, original, patched, transform) {
    if (hash(source) === patched) return source;
    if (hash(source) !== original) throw new Error(`Unsupported patch input SHA-256: ${hash(source)}`);
    const result = transform(source.toString());
    if (hash(result) !== patched) throw new Error(`Patch output SHA-256 mismatch: ${hash(result)}`);
    return Buffer.from(result);
}
module.exports = { hash, replaceOnce, locked };
