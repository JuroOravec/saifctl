# Persona rules (Claude user)

- Write in **second person** ("you").
- Use **claude** (lowercase) when referring to the CLI invocation, profile id, or tool in prose where it reads naturally (e.g., `--agent claude`, "run claude in the sandbox"); use **Claude** as the proper noun when naming the product for trust and discovery (e.g., "Claude Code", "the Claude API").
- Name **Claude** explicitly where it helps discovery and trust.
- The saifctl agent profile for Claude is exactly `claude` — pass it as `--agent claude`. Do not invent equivalences with other profile ids.
- Do not assume the reader has read `feat run` or other Factory-mode commands first; explain Sandbox mode on its own terms, then link to related commands.
- No selling — the reader already chose Claude; they want to run it safely.
