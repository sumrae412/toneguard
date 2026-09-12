import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

// CLAUDE.md and AGENTS.md must stay byte-identical so Codex CLI, generic agent
// runners, and Claude all see the same gotchas — the rule is stated in CLAUDE.md
// itself. Until this test existed the rule had zero mechanical enforcement and
// rode entirely on author discipline, which failed: PR #95 edited CLAUDE.md and
// left AGENTS.md carrying three CI claims that had just been corrected as false.
// An adversarial review caught it; nothing in the repo would have.
//
// Byte comparison, not line-by-line: a read-based check cannot see trailing
// whitespace or a missing final newline, and those are exactly the drifts a
// human diff review skims past.
//
// The rule also documents an escape hatch — divergence is allowed when it is
// intentional and agent-tool-specific, documented at the top of AGENTS.md. This
// test honours that rather than overriding it. A first-line DIVERGENCE marker
// switches the assertion from "identical" to "divergence is declared and gives a
// reason", so following the documented path does not produce a red test whose
// remedy would destroy the divergence.
const DIVERGENCE_RE = /^<!--\s*DIVERGENCE:\s*(.+?)\s*-->/;

// What this does NOT buy, said plainly so nobody over-reads it:
//   - It cannot catch both files being wrong together. Edit AGENTS.md, copy it
//     onto CLAUDE.md, and this passes on whatever you wrote.
//   - With Actions disabled it runs only when someone runs the suite locally,
//     so it makes drift detectable, not impossible.
describe("CLAUDE.md / AGENTS.md mirror", () => {
  const claude = fs.readFileSync(path.join(repoRoot, "CLAUDE.md"));
  const agents = fs.readFileSync(path.join(repoRoot, "AGENTS.md"));
  const firstLine = agents.toString("utf8").split("\n", 1)[0];
  const divergence = firstLine.match(DIVERGENCE_RE);

  it("keeps the two files byte-identical, or declares why not", () => {
    if (divergence) {
      // Documented divergence: require a real reason, not a bare marker.
      expect(
        divergence[1].length,
        "AGENTS.md declares a DIVERGENCE marker with no reason — state why the " +
          "files differ, per the mirror rule in CLAUDE.md",
      ).toBeGreaterThan(10);
      return;
    }

    // Size first, so the failure message leads with the cheap fact.
    expect(
      `AGENTS.md is ${agents.length} bytes`,
      "AGENTS.md has drifted from CLAUDE.md. If unintentional, run: " +
        "cp CLAUDE.md AGENTS.md. If the divergence is deliberate, declare it " +
        "on AGENTS.md line 1 as: <!-- DIVERGENCE: why these differ -->",
    ).toBe(`AGENTS.md is ${claude.length} bytes`);

    expect(
      agents.equals(claude),
      "AGENTS.md differs from CLAUDE.md at equal length. If unintentional, run: " +
        "cp CLAUDE.md AGENTS.md. If deliberate, declare it on AGENTS.md line 1 " +
        "as: <!-- DIVERGENCE: why these differ -->",
    ).toBe(true);
  });
});
