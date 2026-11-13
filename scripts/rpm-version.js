"use strict";

// RPM compares numeric runs numerically and alphabetic runs lexically. Encode
// each SemVer prerelease identifier so those rules preserve SemVer precedence:
// numeric identifiers: a.<number>; others: b<ASCII hex mapped to letters a-p>.
// The a/b prefix places numeric identifiers before nonnumeric identifiers.
// A letters-only encoding preserves ASCII order without RPM splitting digits.
function toRpmVersion(version) {
    const match = typeof version === "string" && version.match(
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
    );
    if (!match) throw new Error(`Unsupported SemVer version: ${version}`);
    const core = match.slice(1, 4).join(".");
    if (!match[4]) return core;
    const prerelease = match[4].split(".").map(identifier => {
        if (/^\d+$/.test(identifier)) {
            if (identifier.length > 1 && identifier.startsWith("0")) {
                throw new Error(`Numeric prerelease identifiers cannot have leading zeros: ${version}`);
            }
            return `a.${identifier}`;
        }
        const encoded = Array.from(Buffer.from(identifier, "ascii"), byte =>
            String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join("");
        return `b${encoded}`;
    }).join(".");
    // Build metadata has no SemVer precedence; retain it in refactor.json only.
    return `${core}~${prerelease}`;
}

if (require.main === module) {
    try {
        const report = JSON.parse(require("node:fs").readFileSync(process.argv[2], "utf8"));
        console.log(toRpmVersion(report.version));
    }
    catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { toRpmVersion };
