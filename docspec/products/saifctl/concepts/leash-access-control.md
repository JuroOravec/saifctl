---
id: leash-access-control
explains: how Leash + Cedar policies enforce filesystem, process, and network boundaries inside the agent container, and how to author custom policies
learning_outcomes:
  - Why access control matters for agents (exfiltration, reward hacking against tests, malicious package pulls, paid-API hammering).
  - The Cedar action vocabulary saifctl uses (`FileOpen`, `FileOpenReadWrite`, `ProcessExec`, `NetworkConnect`).
  - Cedar policy syntax basics (`permit` / `forbid`, "forbid beats permit", `Dir::"…/"` directory matching with mandatory trailing slash, `File::"…"` exact-file matching, `Host::"…"` host allowlists).
  - The three bundled policies — `default` (filesystem-isolated, network-permit), `sandbox` (stricter), `deny-network` — and when each is appropriate.
  - 'The `--cedar` flag and how to author a custom policy file (recipe form: start from a bundled policy, adjust).'
  - What the upstream Leash CEDAR spec covers vs. what saifctl wires.
analogies:
  - allowlist/denylist firewall rules
  - file-permission ACLs but for an entire process tree
---

Body intent: walk the reader from "I don't trust this agent" to "I have a Cedar policy that says exactly what it can and can't do". Cross-link `concepts/security.md` for the threat-model framing.
