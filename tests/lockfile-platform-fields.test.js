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

// The guard's own config is tracked and pages.yml publishes the repo root, so
// a token written by `npm config set ... --location=project` or `npm login`
// would be committed and served. The .npmrc comment says not to; this makes it
// fail instead of relying on someone reading a comment first.
describe(".npmrc hygiene", () => {
  const npmrcPath = path.join(__dirname, "..", ".npmrc");

  // The tests below tolerate a missing .npmrc, and the mirror check passes when
  // `engines` is absent from BOTH sides — so a cleanup that deletes either one
  // would leave the whole suite green while removing the prevention layer.
  // .npmrc says "KEEP BOTH, deleting either opens a version range"; this is what
  // makes that a failing test rather than a comment someone can disagree with.
  it("still declares both halves of the npm floor", () => {
    expect(
      fs.existsSync(npmrcPath) &&
        /^engine-strict\s*=\s*true$/m.test(fs.readFileSync(npmrcPath, "utf-8")),
      "engine-strict is gone from .npmrc. It is the ONLY guard on npm <=10.8, " +
        "which is what node 20 LTS bundles and what strips the lockfile.",
    ).toBe(true);

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
    );
    expect(
      packageJson.devEngines?.packageManager?.name,
      "devEngines.packageManager is gone from package.json. It is what refuses " +
        "on npm >=10.9, where arborist skips the root engines check entirely.",
    ).toBe("npm");
    // Presence is not enough: onFail "warn" keeps the declaration and silently
    // restores the advisory posture this whole guard exists to escape — a
    // warning is what let the April strip through.
    expect(
      packageJson.devEngines?.packageManager?.onFail,
      "devEngines.packageManager.onFail is not 'error', so npm >=10.9 warns " +
        "instead of refusing. That is the posture that produced the April strip.",
    ).toBe("error");
    expect(
      packageJson.engines?.npm,
      "engines.npm is gone from package.json",
    ).toBeTruthy();
  });

  it("carries no registry credentials", () => {
    const npmrc = fs.existsSync(npmrcPath)
      ? fs.readFileSync(npmrcPath, "utf-8")
      : "";

    const secrets = npmrc
      .split("\n")
      .filter((l) => /(_auth|_authToken|_password|:_secret)/i.test(l))
      .filter((l) => !l.trimStart().startsWith("#"));

    expect(
      secrets,
      "Registry credentials in a tracked .npmrc. Move them to ~/.npmrc — this " +
        "file is committed and pages.yml publishes the repo root.",
    ).toEqual([]);
  });
});

// package-lock.json mirrors the root package.json's `engines` into
// packages[""]. It does NOT mirror `devEngines`. An earlier commit on this
// branch dropped `engines` from package.json while the lockfile still carried
// it, producing a lockfile no npm run could have generated — caught in review,
// by reading, with nothing asserting it. Four lines close that.
describe("package-lock.json mirrors package.json", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
  );
  const root = lock.packages?.[""] ?? {};

  it("agrees with package.json on engines", () => {
    expect(
      root.engines,
      "Lockfile root `engines` disagrees with package.json. Re-run npm install " +
        "with npm 11 so the lockfile is one npm could actually have produced.",
    ).toEqual(pkg.engines);
  });

  it("agrees with package.json on devDependencies", () => {
    expect(root.devDependencies).toEqual(pkg.devDependencies);
  });
});
