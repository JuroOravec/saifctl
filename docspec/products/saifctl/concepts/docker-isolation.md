---
id: docker-isolation
explains: how SaifCTL runs the agent in Docker so the host workspace is not modified by default
learning_outcomes:
  - The agent sees a copy of the workspace inside the container.
  - Nothing is written to the host working tree unless you pass `--extract` (or equivalent apply step).
  - Cedar policies via Leash enforce the boundary at the kernel level — filesystem, process, and network.
  - Both `saifctl sandbox` and `saifctl feat run` share this kernel; the difference is whether the agent is also subject to the Factory mode's gauntlet.
analogies:
  - sandpit
  - disposable VM
---

Intent-only body; generated docs will expand this for the product lens.
