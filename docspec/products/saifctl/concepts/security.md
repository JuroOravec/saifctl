---
id: security
explains: what saifctl protects against, what it doesn't, and the design rationale behind the unrestricted-network default
learning_outcomes:
  - The five protections saifctl gives you (host filesystem, agent process integrity via /workspace/saifctl/ write-deny, host secrets, host-hook .git escape, ephemeral container teardown).
  - What saifctl does NOT protect against (network exfiltration by default, kernel exploits, agent CLI supply-chain compromise, malicious LLM-induced typosquats).
  - Why filesystem-as-boundary is the design choice — and why network-default-permit follows from it (preventing all egress would break npm, pip, pnpm, cargo, etc., making the sandbox unusable).
  - The `--cedar` override surface and the three bundled policies (default, sandbox, deny-network).
  - The `dangerousNoLeash` mode — what it disables, when it's appropriate (orchestrator debug, perf profiling, narrowing a Cedar policy), when it isn't (anything with secrets, CI, unattended runs, runs whose diff will be committed without careful review).
  - "Auditability: Leash dashboard pointer."
analogies:
  - filesystem isolation is the lock; network is the open window
  - threat model as a contract — what the contract covers and what it doesn't
---

Long-form companion to top-level `SECURITY.md` (which is responsible-disclosure only). Body intent: explain the threat model in a way that lets a reader decide whether saifctl's posture is acceptable for their project. Cross-link `concepts/leash-access-control.md` for policy authoring.
