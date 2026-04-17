---
name: toneguard
description: >
  Analyze messages for tone, clarity, and professionalism using ToneGuard style rules
  (Summer's personal Chrome extension). Use this skill whenever the user asks to "run
  toneguard", "analyze with toneguard", "check the tone of", or "toneguard this message".
  Also trigger when the user pastes a draft message and asks if it sounds okay, passive-
  aggressive, too harsh, unclear, or needs a rewrite before sending. Applies to Slack
  messages, emails, tenant communications, LinkedIn messages, or any written message.
---

# ToneGuard Skill

Analyzes a message against ToneGuard's style rules and either clears it (no issues) or
flags problems and suggests a rewrite.

> **Canonical source:** `/Users/summerrae/claude_code/toneguard/SKILL.md` (mirrored into the Claude skills-plugin cache). Edit here first; re-sync the cache copy after any change.

## Complementary reference: communication principles

Before analyzing a message, also load `/Users/summerrae/claude_code/claude-skills/shared/communication-principles.md`. The principles there (audience-centered focus, lead with the conclusion, plain-language simplicity, "I help" framing, preparation, control-your-message) apply on top of ToneGuard's style rules — they do not replace them. The ToneGuard rules below are tactical (em dashes, passive-aggressive triggers, hedging); the communication principles are strategic (audience, structure, medium).

Precedence when the two disagree: ToneGuard style rules win on specific phrasing calls (they are more opinionated and user-specific); communication principles win on structure and framing calls.

## Output format

**If the message passes:** One sentence confirming it's clear and on-tone. No rewrite needed.

**If the message has issues:**
1. **Flagged issues** — bullet list of specific problems, each with a brief explanation
2. **Suggested rewrite** — full revised message
3. **What changed** — one line per change, e.g. "Removed em dash → period"

Keep the analysis concise. Don't explain rules the user didn't violate.

---

## Style Rules (from style-rules.md)

### Voice
- Sound like a real person, not a corporate template
- Warm, direct, casual-professional
- Rewrites should read like something Summer would actually send

### Sentence structure
- One idea per sentence; split anything you have to read twice
- Lead with the main point; don't bury the ask
- Cut hedging: "What I mean to say is" → just say it
- State commitments clearly and early

### Things to flag / avoid
- **Em dashes (—)** → reads as AI-generated; use periods or commas
- **"Would you mind... next time"** → passive-aggressive; rewrite as a casual statement
- **"It made me feel..."** → puts reader on the defensive; state what happened and what you need
- **"I noticed you [did X]"** → surveillance energy; use passive framing instead
- **Questions when you mean statements** → "Would you mind checking?" → "Just loop me in"
- **Guilt-trip framing** → keep asks general, not accusatory
- **"Even though I..."** → sounds like building a case
- **"Is everything okay?"** → if you mean "what's going on?", just ask that

### Things to do
- Assume good intent; frame as miscommunication, not mistakes
- Name the specific thing (not "the channel" — name it)
- State what you need clearly; every request should make the ask obvious
- "Going forward" > "next time" (forward-looking, not finger-pointing)
- Pair asks with something positive when appropriate

### Clear is kind (Brené Brown principles)
- Being clear IS being kind; vagueness to avoid discomfort is unkind
- Name the issue directly; don't hint or soften to the point of confusion
- State expectations explicitly; implied expectations are unfair
- If a message dances around a hard topic, say it directly but kindly
- Some things shouldn't be text — if emotionally complex, suggest a call

### Hemingway checks
- Flag sentences over 25 words → split or simplify
- Flag adverbs: "very," "really," "basically," "honestly" → use a stronger verb
- Flag qualifiers: "I think," "sort of," "kind of," "maybe" → commit or cut
- Simpler words: "utilize" → "use," "facilitate" → "help," "commence" → "start"

### Grammarly-style checks
- Grammar, subject-verb agreement, wrong word usage
- Wordy phrases: "in order to" → "to," "due to the fact that" → "because"
- Passive voice: "was completed" → "I completed"
- Tentative openers: "I just wanted to..." → drop "just"; "I'm no expert but..." → drop it
- "Does that make sense?" → replace with a clear statement

### Confidence and engagement
- Strong, relevant first line
- One or two points max per message
- Active voice throughout
- Flag flat, monotone writing

### Slack-specific (if context is Slack)
- Edit ruthlessly; fewer words always
- Use **bold** for key points and actions
- Numbered lists over bullets
- Embed links in phrases; no naked URLs
- Spell out what the reader would otherwise have to calculate

### When NOT to flag
- Message is already clear, warm, and professional → silent pass
- Casual greetings, emoji reactions, quick acknowledgments
- Tone matches context appropriately

---

## Analysis workflow

1. Read the message in full
2. Check against each rule category above
3. If no issues: clear it with one sentence
4. If issues found:
   - List only the rules actually violated (don't enumerate all rules)
   - Write a rewrite that fixes all issues without over-engineering the message
   - Summarize changes in a short diff list
5. Never suggest changes that make the message longer without adding meaning
