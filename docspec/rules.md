# Global rules

- Be concise: no filler, no repeated points.
- Lead with **outcome** (“run AI agents safely”), not category labels.
- Prefer plain language; introduce a necessary term once.
- Saifctl ships explicit agent profiles. When naming a profile, use the exact id as registered in `src/agent-profiles/index.ts` (e.g., `claude`, `cursor`, `aider`, `openhands`, `copilot`, `gemini`, `codex`, `qwen`, `kilocode`, `mini-swe-agent`, `terminus`, `forge`, `deepagents`, `opencode`). The default profile is `openhands`. **Do not invent equivalences between profile ids and external product names** (e.g., do not write "openhands is the agent profile for X" or "X maps to the Y profile"). Reference any external tool by its own name; reference saifctl profiles only by their registered id.
