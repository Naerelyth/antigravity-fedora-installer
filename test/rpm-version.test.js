"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { toRpmVersion } = require("../scripts/rpm-version");

function compareVersions(versions) {
    const encoded = versions.map(toRpmVersion);
    const comparisons = encoded.slice(1).map((version, index) =>
        `print(rpm.vercmp("${encoded[index]}", "${version}") .. " ")`).join("; ");
    const result = spawnSync("rpm", ["--eval", `%{lua:${comparisons}}`], { encoding: "utf8" });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
    return result.stdout.trim().split(/\s+/).map(Number);
}

test("stable version remains readable and build metadata does not change precedence", () => {
    assert.equal(toRpmVersion("2.15.1"), "2.15.1");
    assert.equal(toRpmVersion("2.15.1+build-9"), "2.15.1");
    assert.equal(toRpmVersion("2.16.0-beta-2+build.1"), toRpmVersion("2.16.0-beta-2"));
});

test("RPM preserves canonical SemVer prerelease and stable ordering", () => {
    const versions = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta",
        "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "2.0.0", "10.0.0"];
    assert.deepEqual(compareVersions(versions), versions.slice(1).map(() => -1));
});

test("RPM preserves hyphens, case, digits and identifier prefix order", () => {
    const labels = ["0", "2", "10", "999999999999999999999999999999", "-", "A", "Z", "a",
        "beta", "beta.2", "beta.10", "beta-1", "beta-2", "beta-20", "beta-3", "beta0", "beta1", "beta10", "beta2", "z"];
    assert.deepEqual(compareVersions(labels.map(label => `2.16.0-${label}`)), labels.slice(1).map(() => -1));
});

test("invalid SemVer input is rejected before reaching RPM macros", () => {
    for (const version of ["2.15", "02.15.1", "2.15.1-beta.01", "2.15.1-", "2.15.1+x..y", "2.15.1\n%evil", null]) {
        assert.throws(() => toRpmVersion(version));
    }
});
