---
source: src/cli/commands/doctor.ts
type: cli-command
---

Environment and configuration diagnostics. Runs three checks in sequence: Docker daemon reachable, Leash CLI present, and Hatchet (three-state: token absent → local mode warning; token + `SAIFCTL_EXPERIMENTAL_HATCHET=1` → server mode; token without flag → not yet available). Use when install or credentials are misconfigured before running `feat run` or `sandbox`.
