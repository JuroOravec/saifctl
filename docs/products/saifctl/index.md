# SaifCTL

Run AI agents safely. Implement features end-to-end without manual coding.

SaifCTL has two modes:

- **Sandbox** (`saifctl sandbox`) — run any agent CLI inside an ephemeral Docker container with Cedar/Leash boundaries. Nothing reaches your host unless you opt in with `--extract`.
- **Factory** — spec-driven AI software factory. `saifctl feat run` writes code, passes tests, survives a reviewer, and opens a PR — without you touching the keyboard.

Both modes share the same kernel: ephemeral Docker container, Cedar policies enforced via Leash, copy-not-mount workspace.

---

## Run OpenClaw safely

You want to run OpenClaw without risking your machine. The sandbox puts openclaw in a container; your project is copied in. The agent cannot touch the host until you say so.

| What you want to do                                | Where to go                                                   |
| -------------------------------------------------- | ------------------------------------------------------------- |
| Run OpenClaw so it can't touch your project        | [How-to: Run an agent safely](how-tos/run-agent-safely.md)    |
| Apply the agent's output to your real project      | [How-to: Apply agent changes](how-tos/apply-agent-changes.md) |
| Understand what stays in the container vs the host | [Concept: Docker isolation](concepts/docker-isolation.md)     |
| Walk through your first sandbox run step by step   | [Tutorial: First sandbox run](tutorials/first-sandbox-run.md) |

---

## Implement features with the Factory

You want the agent to implement a feature from a spec — writes code, passes tests, survives the reviewer, opens a PR.

| What you want to do                                   | Where to go                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| Run your first feature end-to-end                     | [How-to: Run your first feature](how-tos/run-first-feature.md)                  |
| Understand how regressions are mechanically prevented | [How-to: Understand safety guarantees](how-tos/understand-safety-guarantees.md) |
| Steer a running agent without restarting it           | [How-to: Provide feedback with run rules](how-tos/provide-feedback.md)          |
| Step into the container and fix an off-track run      | [How-to: Inspect and resume a run](how-tos/inspect-and-start.md)                |
| Diagnose setup errors                                 | [How-to: Troubleshoot setup](how-tos/troubleshoot.md)                           |
| Walk through spec-driven development end to end       | [Tutorial: Spec-driven development](tutorials/spec-driven-development.md)       |
| Go from spec to open PR                               | [Tutorial: Spec to PR](tutorials/spec-to-pr.md)                                 |

---

## Key concepts

- [feat-run loop](concepts/feat-run-loop.md) — how the agent, gate, reviewer, and holdout interact
- [Gate, Reviewer, and Holdout](concepts/gate-reviewer-holdout.md) — why regressions are mechanically prevented
- [Run lifecycle](concepts/run-lifecycle.md) — states a run moves through from start to PR
- [Docker isolation](concepts/docker-isolation.md) — what is and isn't protected by the container boundary
- [Leash access control](concepts/leash-access-control.md) — Cedar policy enforcement inside the sandbox
- [Sandbox](concepts/sandbox.md) — sandbox mode in depth
- [Features](concepts/features.md) — how specs and tests define a feature for the Factory
