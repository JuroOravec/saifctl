# saifac run inspect

Print a stored run artifact as JSON for debugging or piping to tools.

## Usage

```bash
saifac run inspect <runId> [options]
```

## Arguments

| Argument        | Alias | Type    | Description                                                                                   |
| --------------- | ----- | ------- | --------------------------------------------------------------------------------------------- |
| `runId`         | —     | string  | Run ID to inspect (positional, required)                                                    |
| `--pretty`      | —     | boolean | Pretty-print JSON (default: true). Citty maps `--no-pretty` to `pretty: false` (single line). |
| `--project-dir` | —     | string  | Project directory (default: current working directory)                                      |
| `--saifac-dir`  | —     | string  | Saifac config directory relative to project (default: `saifac`)                             |
| `--storage`     | —     | string  | Run storage: `runs=local` \| `runs=none` \| `runs=file:///path` \| `runs=s3` (default: local) |

## Examples

Pretty-printed JSON (default):

```bash
saifac run inspect abc12x
```

Compact JSON for piping:

```bash
saifac run inspect abc12x --no-pretty | jq .config.featureName
```

Example of the default **pretty-printed** output:

```json
{
  "runId": "abc12x",
  "baseCommitSha": "a1b2c3d",
  "specRef": "saifac/features/add-login",
  "lastFeedback": "Test failure: expected 200, got 404",
  "config": {
    "featureName": "add-login",
    "gitProviderId": "github",
    "testProfileId": "vitest",
    "sandboxProfileId": "vitest",
    "projectDir": "/path/to/repo",
    "maxRuns": 5,
    "overrides": {},
    "saifDir": "saifac",
    "projectName": "my-app",
    "testImage": "safe-ai-factory-test:latest",
    "resolveAmbiguity": "ai",
    "dangerousDebug": false,
    "cedarPolicyPath": "",
    "coderImage": "",
    "push": null,
    "pr": false,
    "gateRetries": 10,
    "reviewerEnabled": true,
    "agentEnv": {},
    "agentLogFormat": "openhands",
    "startupScriptFile": "sandbox-profiles/vitest/startup.sh",
    "gateScriptFile": "sandbox-profiles/vitest/gate.sh",
    "stageScriptFile": "sandbox-profiles/vitest/stage.sh",
    "testScriptFile": "test-profiles/vitest/test.sh",
    "agentInstallScriptFile": "agent-profiles/aider/agent-install.sh",
    "agentScriptFile": "agent-profiles/aider/agent.sh",
    "testRetries": 1,
    "stagingEnvironment": {
      "provisioner": "docker",
      "app": { "sidecarPort": 8080, "sidecarPath": "/exec" },
      "appEnvironment": {}
    },
    "codingEnvironment": { "provisioner": "docker" }
  },
  "status": "failed",
  "startedAt": "2026-03-21T10:00:00.000Z",
  "updatedAt": "2026-03-21T10:15:00.000Z"
}
```

## See also

- [Runs](../runs.md) — Run storage overview
- [saifac run list](run-list.md) — List run IDs
- [saifac run resume](run-resume.md) — Resume a failed run
