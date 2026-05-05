---
id: run-lifecycle
explains: how a saved Run progresses through its statuses (running, paused, failed, completed) and which commands move it between states
learning_outcomes:
  - A Run is a saved attempt pipeline identified by a run ID; metadata + patch history live in storage (`local`, `file://`, `s3`, `none`).
  - The status machine: running → (paused | failed | completed); paused → resumed (back to running); failed → started (back to running).
  - Pause vs Stop: Pause preserves sandbox + Docker network for `run resume`; Stop tears everything down.
  - Pause/resume granularity is per-subtask (per phase / per critic round for phased runs); resume re-enters at the same subtask cursor.
  - `--max-runs` is per-subtask, not per-run.
  - `run start` is for failed/interrupted runs; reconstructs workspace from git + saved commits. Not for paused runs.
  - `run resume` is for paused runs; reuses the cached sandbox + Docker network when present, falls back to `start` semantics if cache is gone.
analogies:
  - process lifecycle (running, paused, killed)
  - git rebase --continue vs git stash apply
---

Intent-only body; generated docs will expand with the status diagram + command map.
