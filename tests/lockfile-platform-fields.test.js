import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lockPath = path.join(__dirname, "..", "package-lock.json");
const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));

// npm 10 silently strips the "libc" platform fields that npm 11 writes. Those
// fields tell a resolver which glibc/musl build of a native binding applies, so
// losing them degrades linux/musl resolution with no error and a diff that
// reads as noise.
//
// It has already happened once on main: 952e9fd (2026-04-03) removed all 10
// entries, and main recovered only because later installs happened to run a
// newer npm.
//
// devEngines.packageManager prevents the common cause. This catches the OUTCOME
// regardless of cause — that field being deleted, an env override, a tool that
// rewrites the lockfile without reading package.json, or a future npm changing
// behaviour again. Prevention and detection fail independently, which is why
// both exist.
//
// The rule is derived from the package name rather than a pinned list, so
// adding or removing a native dependency does not require editing this file.
// Note `-gnueabihf` is deliberately NOT matched by /-gnu$/: armv7l ships one
// variant and carries no libc discriminator, which is correct and not a strip.
const GNU = /-gnu$/;
const MUSL = /-musl$/;

describe("package-lock.json platform fields", () => {
  const entries = Object.entries(lock.packages ?? {});

  it("keeps a libc field on every -gnu / -musl native binding", () => {
    const shouldHaveLibc = entries.filter(
      ([p]) => GNU.test(p) || MUSL.test(p),
    );

    const missing = shouldHaveLibc
      .filter(([, m]) => !Array.isArray(m?.libc))
      .map(([p]) => p);

    expect(
      missing,
      "These native bindings lost their libc field — almost certainly an npm 10 " +
        "install, which strips them silently. Re-run with npm 11 " +
        "(npm install -g npm@11) and commit the restored lockfile.",
    ).toEqual([]);

    // Guard the guard: if the tree ever stops containing such packages the
    // assertion above passes vacuously, which would look like success.
    expect(
      shouldHaveLibc.length,
      "No -gnu/-musl native bindings found — this test has gone vacuous and " +
        "should be re-examined rather than left green.",
    ).toBeGreaterThan(0);
  });

  it("gives each binding the libc value its name implies", () => {
    const wrong = entries
      .filter(([, m]) => Array.isArray(m?.libc))
      .filter(([p, m]) => {
        if (GNU.test(p)) return !m.libc.includes("glibc");
        if (MUSL.test(p)) return !m.libc.includes("musl");
        return false;
      })
      .map(([p, m]) => `${p} -> ${JSON.stringify(m.libc)}`);

    expect(wrong, "libc value disagrees with the package name").toEqual([]);
  });

  it("still resolves every dependency from the public npm registry", () => {
    const offRegistry = entries
      .filter(([p, m]) => p !== "" && m?.resolved)
      .filter(([, m]) => !m.resolved.startsWith("https://registry.npmjs.org/"))
      .map(([p, m]) => `${p} -> ${m.resolved}`);

    expect(offRegistry, "Dependency resolved from an unexpected host").toEqual(
      [],
    );
  });
});
