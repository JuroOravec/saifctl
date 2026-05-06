# Run storage reference

Store run metadata, patches, and sandbox state so you can inspect, resume, fork, or apply results later. Configure a backend with `--storage` on any `saifctl` command, or set it in `saifctl/config.yaml`.

---

## Backends

| Value | Where data goes | Setup required |
|---|---|---|
| `local` | `.saifctl/runs/` under the project root | None — the default |
| `file://<path>` | Local filesystem at `<path>` | Path must be writable |
| `s3://<bucket>[/<prefix>]` | Amazon S3 (or compatible) | AWS credentials in env |
| `none` | Disabled — data is not persisted | None |

`saifctl sandbox` defaults to `none`. For all other commands the default is `local`.

---

## URI format

| Shorthand | Expands to |
|---|---|
| `local` | `file://{projectDir}/.saifctl` |
| `none` / `memory` | no storage (null — nothing written or retained) |
| `s3` | `s3://{SAIF_DEFAULT_S3_BUCKET}` |

Full URIs are also accepted:

```
file:///absolute/path
s3://my-bucket
s3://my-bucket/some/prefix
s3://my-bucket?profile=staging&region=eu-west-1
```

### S3 query parameters

| Parameter | Description |
|---|---|
| `profile` | AWS named profile to use (overrides `AWS_PROFILE`). |
| `region` | AWS region (overrides `AWS_DEFAULT_REGION`). |

---

## Environment variables

| Variable | Used by |
|---|---|
| `SAIF_DEFAULT_S3_BUCKET` | Required when using the `s3` shorthand. Set to your bucket name. |
| `AWS_PROFILE` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Standard AWS credential chain used by the S3 backend. |

---

## CLI flags

| Flag | Config field | Description |
|---|---|---|
| `--storage <uri>` | `defaults.globalStorage` | Bare URI sets the global backend for all namespaces (e.g. `--storage s3://bucket`). |
| `--storage <key>=<uri>,...` | `defaults.storages` | Key=value pairs set per-namespace overrides (e.g. `--storage runs=local,tasks=s3`). Both forms may be combined in a single flag. |

**Precedence:** `--storage <key>=<uri>` entries > bare `--storage <uri>` global value > `defaults.globalStorage` in config file > built-in default (`local`).

---

## Per-namespace overrides

Namespaces (`runs`, `tasks`) can use different backends:

```yaml
# saifctl/config.yaml
defaults:
  globalStorage: local
  storages:
    runs: s3://my-bucket/runs
    tasks: local
```

Or on the CLI:

```bash
saifctl feat run --storage runs=s3://my-bucket/runs,tasks=local
```

---

## Feature support matrix

| Feature | `local` | `file://` | `s3://` | `none` |
|---|---|---|---|---|
| `run inspect` / reattach | yes | yes | yes | no |
| `run list` | yes | yes | yes | no |
| `run resume` / `fork` | yes | yes | yes | no |
| Survives process restart | yes | yes | yes | no |
| Multi-host access | no | shared-mount only | yes | no |

---

## Examples

```bash
# Use the default local backend (no flag needed)
saifctl feat run

# Store runs in S3 using SAIF_DEFAULT_S3_BUCKET
export SAIF_DEFAULT_S3_BUCKET=my-ci-bucket
saifctl feat run --storage s3

# Explicit S3 bucket with a prefix and named profile
saifctl feat run --storage "s3://my-bucket/saifctl?profile=ci"

# Custom local path (e.g. shared NFS mount)
saifctl feat run --storage "file:///mnt/nfs/saifctl-runs"

# Disable storage for a one-shot sandbox session
saifctl sandbox --storage none

# Override storage in config
# saifctl/config.yaml:
# defaults:
#   globalStorage: s3://my-bucket/saifctl
```
