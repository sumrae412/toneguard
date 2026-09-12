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
describe("CLAUDE.md / AGENTS.md mirror", () => {
  it("keeps the two files byte-identical", () => {
    const claude = fs.readFileSync(path.join(repoRoot, "CLAUDE.md"));
    const agents = fs.readFileSync(path.join(repoRoot, "AGENTS.md"));

    // Compare sizes first so the failure message names the cheap fact.
    expect(
      `AGENTS.md is ${agents.length} bytes`,
      "AGENTS.md has drifted from CLAUDE.md — run: cp CLAUDE.md AGENTS.md",
    ).toBe(`AGENTS.md is ${claude.length} bytes`);

    expect(
      agents.equals(claude),
      "AGENTS.md differs from CLAUDE.md at equal length — run: cp CLAUDE.md AGENTS.md",
    ).toBe(true);
  });
});
