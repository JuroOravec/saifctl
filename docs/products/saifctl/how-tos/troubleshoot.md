# Troubleshoot saifctl setup issues

If you're seeing a **saifctl docker error**, **saifctl not working**, or hitting a **saifctl install issue**, this guide covers the most common causes and how to fix them. Run `saifctl doctor` first — it checks your environment in one step and tells you exactly what's missing.

## Prerequisites

- saifctl installed (if installation itself failed, start with the install guide)
- Docker installed (Desktop on macOS/Windows, Engine on Linux)

## Steps

### 1. Run `saifctl doctor`

```bash
saifctl doctor
```

This performs all environment checks and prints a pass/fail for each dependency. Use the output to identify which section below applies.

---

### 2. Docker not running

**Symptom:** `saifctl docker daemon` error or `Cannot connect to the Docker daemon`.

**Fix:**

- macOS/Windows: open Docker Desktop and wait for it to reach "running" state.
- Linux:
  ```bash
  sudo systemctl start docker
  ```

Re-run `saifctl doctor` to confirm Docker is healthy before continuing.

---

### 3. Leash CLI missing

**Symptom:** `leash: command not found` or doctor reports Leash not present.

**Fix:** Install or update the Leash CLI. See `vendor/leash/README.md` in the saifctl repository for the exact install command for your platform.

---

### 4. Argus binary fetch failing

**Symptom:** Startup stalls or errors during reviewer initialization; logs mention a failed download from GitHub releases.

**Fix:** Confirm outbound HTTPS access to `https://github.com/safe-ai-factory/argus/releases`. If your environment blocks that host, run without the reviewer:

```bash
saifctl feat run --no-reviewer --name <feature>
```

---

### 5. Hatchet token set without the experimental flag

**Symptom:** Error referencing Hatchet config or an unexpected experimental-feature guard.

**Fix (option A):** Enable the experimental Hatchet integration:

```bash
export SAIFCTL_EXPERIMENTAL_HATCHET=1
```

**Fix (option B):** Unset the token to fall back to local mode:

```bash
unset HATCHET_CLIENT_TOKEN
```

Per decision D-04, local mode is the default and fully supported; Hatchet is opt-in.

---

### 6. Permission denied on `/tmp/saifctl/…`

**Symptom:** `permission denied` errors pointing to `/tmp/saifctl/sandboxes/` paths.

**Fix:** Clear stale sandbox state:

```bash
saifctl cache clear
```

> **Note:** `saifctl cache clear` only removes entries under `/tmp/saifctl/sandboxes/`. Permission-denied errors on other `/tmp/saifctl/` subdirectories (e.g. `/tmp/saifctl/bin/`) require manual remediation such as `sudo rm -rf /tmp/saifctl/bin/`.

---

### 7. Image pull failures

**Symptom:** `docker pull` errors during container startup; image not found or rate-limited.

**Fix:** Pre-pull the required image explicitly:

```bash
docker pull ghcr.io/safe-ai-factory/saifctl/<image>:<tag>
```

Replace `<image>` and `<tag>` with the values shown in the error. For the full list of published images and tags, see [Docker images reference](../../../references/docker-images.md).

---

## Verification

After applying a fix, run:

```bash
saifctl doctor
```

All checks should pass. Then re-run your original command.

## See also

- [`saifctl doctor` reference](../../../references/commands/doctor.md) — full list of checks and exit codes
- [Docker images reference](../../../references/docker-images.md) — available images and tags
