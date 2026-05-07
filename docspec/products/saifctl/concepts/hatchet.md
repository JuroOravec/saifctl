---
id: hatchet
explains: when and why to opt into Hatchet (durable, distributed orchestration) vs. the default in-process mode, and what changes when you do
learning_outcomes:
  - 'Default mode (no `HATCHET_CLIENT_TOKEN`): saifctl runs in-process — no external services, no setup, fine for single-developer use.'
  - Setting `HATCHET_CLIENT_TOKEN` opts into Hatchet, adding durability (resume across crashes), distributed execution (multiple workers), a dashboard.
  - '**Status in v0.1**: Hatchet integration is gated behind `SAIFCTL_EXPERIMENTAL_HATCHET=1`. Without that flag, setting `HATCHET_CLIENT_TOKEN` raises an error pointing here. Local mode is unaffected. (Per Decision D-04.)'
  - 'Trade-offs: durability + distribution vs. setup complexity (Hatchet server, gRPC connectivity, token management).'
analogies:
  - the difference between `setTimeout` (in-process) and a job queue (distributed)
  - vitest run vs. CI pipeline — same tests, different execution model
---

Body intent: explain when Hatchet is worth setting up. Treat as a "coming soon" page in the v0.1 docs since the flag is experimental.
