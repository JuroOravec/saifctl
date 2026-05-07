---
persona: engineer
tasks:
  - troubleshoot-setup
goal: Diagnose and resolve common saifctl setup issues — Docker, Leash CLI, Argus, Hatchet
---

How-to intent: a triage flow. Start with `saifctl doctor` (which checks Docker daemon, Leash CLI presence, Hatchet config). For each common failure mode, give the specific symptom + fix:

- **Docker not running** — start Docker Desktop / `systemctl start docker`.
- **Leash CLI missing** — install or update; pointer to vendor/leash README.
- **Argus binary fetch failing** — check network egress to GitHub releases (`https://github.com/safe-ai-factory/argus/releases`); offline workaround `--no-reviewer`.
- **Hatchet token set without experimental flag** — set `SAIFCTL_EXPERIMENTAL_HATCHET=1` or unset the token to fall back to local mode (per release-readiness/D-04).
- **Permission denied on /tmp/saifctl/...** — clear stale state via `saifctl cache clear`.
- **Image pull failures** — pre-pull with `docker pull ghcr.io/safe-ai-factory/saifctl/<image>:<tag>`; pointer to `references/docker-images.md`.

Cross-link `references/commands/doctor.md` for the underlying check definitions.
