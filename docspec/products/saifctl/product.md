# SaifCTL

SaifCTL is one tool with two modes:

- **Sandbox** (`saifctl sandbox`) — run any agent CLI inside an ephemeral Docker container with Cedar/Leash filesystem, process, and network boundaries. The host is untouched unless you opt in via `--extract`. No specs, no tests required.
- **Factory** (`saifctl feat run`) — a spec-driven AI software factory. Define what to build (specs and TDD tests) and SaifCTL runs agents through a convergence loop (Gate, Reviewer, Holdout tests) until the code passes all gates.

Both modes share the same kernel: ephemeral Docker container, Cedar policies enforced via Leash, copy-not-mount workspace.

Primary outcomes:

- Sandbox: run an agent safely in one command; nothing reaches the host unless you say so.
- Factory: `saifctl feat run` implements a feature end to end — writes code, passes tests, survives the reviewer, opens a PR — without manual coding.
