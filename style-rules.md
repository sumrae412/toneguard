# ToneGuard Style Rules

Learned from real examples with Summer. These rules drive both tone detection and rewrite quality.

## Voice Principles

- Sound like a real person, not a corporate template
- Match Summer's natural voice: warm, direct, casual-professional
- Rewrites should read like something she'd actually send

## Rewrite Rules

### Sentence structure
- One idea per sentence. If you have to read it twice, split it up
- Put what happened first, then why. Cause and effect in that order
- Short sentences > long ones. When in doubt, break it apart
- Lead with the main point. Don't bury the key takeaway at the end
- Cut hedging and qualifications. "What I mean to say is" → just say it. "I suspect that's where" → "That's where"
- State commitments clearly and early. "I'll take another look tomorrow" shouldn't be the last thing in a paragraph of backtracking

### Things to avoid
- **Em dashes (—)** — reads as AI-generated. Use periods or commas instead
- **"Would you mind..." + "next time"** — sounds passive-aggressive. Make it a casual statement instead
- **"Pulling someone else in" / singling out what they did wrong** — guilt-trippy. Keep asks general
- **"It made me feel..."** — puts the other person on the defensive. State what happened and what you need instead
- **"Even though I..."** — sounds like building a case. Weave context in naturally
- **"Is everything okay?"** — when you actually mean "what's going on?" just ask directly
- **"I noticed you [did thing]"** — "I'm watching you" energy. Use passive framing ("I saw X was done")
- **Packing two unrelated ideas into one sentence** — if they don't connect, make them separate sentences
- **Questions when you mean statements** — "would you mind checking with me?" → "just loop me in and I'll get right on it"

### Things to do
- **Assume good intent** — frame things as miscommunication, not mistakes
- **Name the specific thing** — don't say "the channel" or "the thing." Name it. If the reader has to guess what you're referring to, it's too vague
- **State what you need** — every request should make clear what you want someone to do. "Could someone take a look?" is vague. "Could someone review the audio levels in the SGLang channel?" is clear
- **Make clear requests** — say what you want going forward, not what went wrong
- **"Going forward" > "next time"** — forward-looking, not finger-pointing
- **Reassure when asking for change** — pair the ask with something positive ("I'll get right on it")
- **Split complex context into simple steps** — what you did, what happened, what you need

## Clarity and Explanation Principles

These apply especially when explaining technical concepts, processes, or distinctions to others.

### Clarity over terminology
- Replace jargon with intuitive phrases when the meaning is preserved. "Shared prefixes" → "beginning of a prompt" or "repeated text"
- If a term requires prior knowledge, either replace it or define it inline in one clause. Never leave it implicit

### Explain the mechanism, not just the label
- Saying what something *does* (store, reuse, skip recomputation) is more useful than just naming it
- Anchor explanations in where and how something works, not just that it works

### Precise distinctions matter
- Don't collapse related-but-different concepts into one idea ("it makes things faster")
- If two things work differently, say how they differ, even briefly

### Progressive simplification
- Start with a correct statement, then iteratively remove unnecessary abstraction
- Replace abstract terms with concrete mental models ("save work," "compare words")
- Final version should be simple, precise, and teachable

### Inline definitions reduce cognitive load
- Expand technical terms directly in the sentence rather than requiring separate explanations
- Example: instead of "attention computations," say "comparing words to determine which ones matter most"

### Tradeoff management
- Simplicity vs. precision should be chosen based on audience
- For teaching or explaining to non-experts, controlled simplification is usually the better default
- For technical peers, precision matters more

## When to intervene

- Only flag messages that actually need work
- If the message is already clear and kind, silent pass-through
- Catch subtle stuff: passive-aggression, defensive framing, guilt-trips, buried asks
- Catch sloppy/incoherent messages: gibberish, excessive slang that obscures meaning, messages that wouldn't make sense to the recipient
- Don't flag casual/friendly tone as unprofessional, but DO flag unclear or nonsensical messages

## When NOT to intervene

- Message is already clear, warm, and professional
- Casual greetings, emoji reactions, quick acknowledgments
- The tone matches the context appropriately
