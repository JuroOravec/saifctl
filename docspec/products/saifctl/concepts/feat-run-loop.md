---
id: feat-run-loop
explains: how saifctl feat run drives an agent through a convergence loop until code passes all gates, including the per-phase + per-critic-round structure for phased features, and what to do with the resulting commits when the loop concludes
learning_outcomes:
  - The agent is locked in a loop and cannot stop until gate, reviewer, and holdout all pass.
  - Each iteration the agent sees gate failures and must fix them.
  - You are only notified when the code emerges victorious.
  - Phased features (with a `phases/` dir) repeat the loop per phase — each phase has its own spec, tests, and critics, and a phase's gate must pass before the next starts.
  - Critic rounds run after the phase's gate passes; each critic adds two extra subtasks (discover + fix) before the phase is considered done.
  - 'Per-subtask test scope: tests run from the cumulative `phases/<id>/tests/**` PLUS feature-level `tests/**`, so later phases never break earlier ones.'
  - 'Two wall-clock timeouts bound the loop: `--run-timeout` (default unbounded — total budget across all subtasks) and `--subtask-timeout` (default 1h — resets per subtask). Either firing aborts the run with the same save-artifact-and-resume semantics as an in-container error; resume with `saifctl run start <id>`.'
  - "When the loop concludes, the run's commits sit on a generated `saifctl/<feature>-<runId>-<hash>` branch. Three follow-up commands consume it: `saifctl run merge <runId>` (into the current branch, safe with a dirty tree under `--allow-dirty`), `saifctl run apply <runId> --push <target> [--pr]` (push the branch and open a PR), or `saifctl run export <runId>` (write a `.patch` file). The post-loop console output prints all three with the runId pre-filled."
analogies:
  - compiler error loop (write, compile, fix, repeat)
  - CI red/green cycle
  - phased features behave like a CI matrix where each row gates the next
---

Intent-only body; generated docs will expand this for the product lens.
