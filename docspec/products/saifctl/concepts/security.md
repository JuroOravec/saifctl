---
id: security
explains: what saifctl protects against, what it doesn't, and the design rationale behind the unrestricted-network default
learning_outcomes:
  - The five protections saifctl gives you (host filesystem, agent process integrity via /workspace/saifctl/ write-deny, host secrets, host-hook .git escape, ephemeral container teardown).
  - What saifctl does NOT protect against (network exfiltration by default, kernel exploits, agent CLI supply-chain compromise, malicious LLM-induced typosquats).
  - 'Why network is permit-by-default — pragmatic, not principled. A maintainable allowlist covering LLM APIs, npm/PyPI/crates.io/Go-module-proxy/apt registries, GitHub, container registries, doc hosts, plus arbitrary project-specific dependencies is intractable to define for arbitrary user projects. Filesystem isolation does the actual blast-radius containment; the network is a known unmitigated exfiltration channel by default. Users who *can* enumerate their allowlist opt in via `--cedar` or the bundled `deny-network.cedar`. Per Decision release-readiness/D-06.'
  - The `--cedar` override surface and the three bundled policies (default, sandbox, deny-network).
  - The `dangerousNoLeash` mode — what it disables, when it's appropriate (orchestrator debug, perf profiling, narrowing a Cedar policy), when it isn't (anything with secrets, CI, unattended runs, runs whose diff will be committed without careful review).
  - 'Auditability: Leash dashboard pointer.'
  - "Profile-injected credentials (e.g. `--claude-max` staging the user's Claude Max OAuth tokens into the coder container as a 0600 file owned by the unpriv user). Trade-offs vs an API key: API key is workspace-scoped + revocable per-project; OAuth is tied to the user's personal account and shares rate limits with their interactive use. A compromised agent in OAuth mode has Max plan access until manually revoked. Use API keys for CI / shared / unattended runs; reserve `--claude-max` for personal/local development."
analogies:
  - filesystem isolation is the lock; network is the open window
  - threat model as a contract — what the contract covers and what it doesn't
---

Long-form companion to top-level `SECURITY.md` (which is responsible-disclosure only). Body intent: explain the threat model in a way that lets a reader decide whether saifctl's posture is acceptable for their project. Cross-link `concepts/leash-access-control.md` for policy authoring.
