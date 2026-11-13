"use strict";

const fs = require("node:fs");
const { hash } = require("./contracts");

function align4(value) {
    return value + ((4 - (value % 4)) % 4);
}

function encodeAsarHeader(header) {
    const json = Buffer.from(JSON.stringify(header), "utf8");
    const headerPayloadSize = 4 + align4(json.length);
    const headerPickle = Buffer.alloc(4 + headerPayloadSize);
    headerPickle.writeUInt32LE(headerPayloadSize, 0);
    headerPickle.writeInt32LE(json.length, 4);
    json.copy(headerPickle, 8);

    const sizePickle = Buffer.alloc(8);
    sizePickle.writeUInt32LE(4, 0);
    sizePickle.writeUInt32LE(headerPickle.length, 4);
    return Buffer.concat([sizePickle, headerPickle]);
}

function integrityFor(content) {
    const blockSize = 4 * 1024 * 1024;
    const blocks = [];
    for (let offset = 0; offset < content.length; offset += blockSize) {
        blocks.push(hash(content.subarray(offset, offset + blockSize)));
    }
    return {
        algorithm: "SHA256",
        hash: hash(content),
        blockSize,
        blocks,
    };
}

function appendFile(header, pathSegments, content, offset) {
    let directory = header;
    for (const segment of pathSegments.slice(0, -1)) {
        const entry = directory.files?.[segment];
        if (!entry?.files) {
            throw new Error(`ASAR directory contract is missing: ${pathSegments.slice(0, -1).join("/")}`);
        }
        directory = entry;
    }
    directory.files[pathSegments.at(-1)] = {
        size: content.length,
        offset: String(offset),
        integrity: integrityFor(content),
    };
}

function readArchive(archivePath) {
    const buffer = fs.readFileSync(archivePath);
    if (buffer.length < 16 || buffer.readUInt32LE(0) !== 4) {
        throw new Error(`Invalid ASAR size pickle: ${archivePath}`);
    }
    const headerSize = buffer.readUInt32LE(4);
    const headerEnd = 8 + headerSize;
    if (headerSize < 8 || headerEnd > buffer.length) {
        throw new Error(`Invalid ASAR header size: ${headerSize}`);
    }
    const headerPayloadSize = buffer.readUInt32LE(8);
    const jsonLength = buffer.readInt32LE(12);
    if (jsonLength < 0 || headerPayloadSize < jsonLength + 4 || 16 + jsonLength > headerEnd) {
        throw new Error("Invalid ASAR header payload");
    }
    const header = JSON.parse(buffer.subarray(16, 16 + jsonLength).toString("utf8"));

    const entry = (archivePathname) => {
        let current = header;
        for (const segment of archivePathname.replace(/^\/+/, "").split("/")) {
            current = current.files?.[segment];
            if (!current) {
                throw new Error(`ASAR entry not found: ${archivePathname}`);
            }
        }
        return current;
    };
    const extractFile = (archivePathname) => {
        const file = entry(archivePathname);
        if (file.unpacked || typeof file.offset !== "string" || typeof file.size !== "number") {
            throw new Error(`ASAR entry is not a packed file: ${archivePathname}`);
        }
        const start = headerEnd + Number(file.offset);
        const end = start + file.size;
        if (!Number.isSafeInteger(start) || start < headerEnd || end > buffer.length) {
            throw new Error(`ASAR entry is out of bounds: ${archivePathname}`);
        }
        return buffer.subarray(start, end);
    };
    return { buffer, extractFile, header, headerSize };
}

// Append replacements without repacking untouched entries or changing offsets.
function patchArchive(archive, replacements) {
    if (!replacements.size) return archive.buffer;
    const header = structuredClone(archive.header);
    const chunks = [archive.buffer.subarray(8 + archive.headerSize)];
    let offset = chunks[0].length;
    for (const [filename, content] of replacements) {
        appendFile(header, filename.split("/"), content, offset);
        chunks.push(content);
        offset += content.length;
    }
    return Buffer.concat([encodeAsarHeader(header), ...chunks]);
}

module.exports = { readArchive, encodeAsarHeader, patchArchive };
