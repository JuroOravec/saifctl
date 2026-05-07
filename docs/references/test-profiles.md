# Test Profiles

A **test profile** configures the Test Runner container — the language, framework, file naming, and scaffolding templates used when generating and running tests. It is separate from the sandbox profile, which configures the coder container.

The default profile is `node-vitest`.

---

## Shipped profiles

| ID                  | Language | Framework  |
| ------------------- | -------- | ---------- |
| `node-vitest`       | Node.js  | Vitest     |
| `node-playwright`   | Node.js  | Playwright |
| `python-pytest`     | Python   | pytest     |
| `python-playwright` | Python   | Playwright |
| `go-gotest`         | Go       | go test    |
| `go-playwright`     | Go       | Playwright |
| `rust-rusttest`     | Rust     | cargo test |
| `rust-playwright`   | Rust     | Playwright |

---

## Selecting a profile

Pass `--test-profile <id>` to any command that accepts it:

```bash
saifctl feat run --test-profile python-pytest
saifctl feat design-tests --test-profile go-gotest
```

To use a custom image instead of a shipped profile, pass `--test-image <image>` directly. This bypasses profile resolution entirely.

---

## How a profile is used

Each profile drives four subsystems:

| Subsystem                      | What the profile provides                                                    |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `tests-catalog` agent          | Generates entrypoint paths with the correct extension and naming convention  |
| `tests-coder` agent            | Generates test code in the correct language and framework                    |
| `generateTests`                | Copies the correct helpers and infra template files into the tests directory |
| `loadTestScriptFromPick` (CLI) | Selects the profile's `test.sh` as the default `--test-script`               |

---

## Profile structure

Each shipped profile lives under `src/test-profiles/<id>/` and contains:

| File         | Purpose                                                 |
| ------------ | ------------------------------------------------------- |
| `profile.ts` | Profile definition (see `TestProfile` interface below)  |
| `test.sh`    | Default test script run by the Test Runner              |
| `Dockerfile` | Image definition for the Test Runner container          |
| `templates/` | Helpers, infra health-check, and example spec templates |

---

## `TestProfile` interface

```typescript
interface TestProfile {
  id: SupportedProfileId; // Profile id used in CLI flags and tests.json
  language: string; // Human-readable language name (e.g. "Node.js")
  framework: string; // Test framework name (e.g. "Vitest")
  specExtension: string; // Spec file extension, including dot (e.g. ".spec.ts")
  fileNamingRule: string; // Naming convention injected into the catalog agent prompt
  helpersFilename: string; // Filename of the helpers template
  infraFilename: string | null; // Filename of the infra health-check template; null = none
  exampleFilename: string; // Filename of the example/seed spec template
  importRules: string; // Import lines injected into the coder agent prompt
  assertionRules: string; // Assertion rules injected into the coder agent prompt
  onDone?: (opts: OnDoneOpts) => void | Promise<void>; // Optional post-generation hook
  validateFiles?: (opts: ValidateFilesOpts) => void | Promise<void>; // Optional validation hook
}
```

### `OnDoneOpts`

Passed to `onDone` after all spec files are generated:

| Field            | Type       | Description                          |
| ---------------- | ---------- | ------------------------------------ |
| `testsDir`       | `string`   | Absolute path to the tests directory |
| `generatedFiles` | `string[]` | Paths of all generated spec files    |
| `force`          | `boolean`  | Whether `--force` was passed         |

### `ValidateFilesOpts`

Passed to `validateFiles` after spec file generation:

| Field            | Type       | Description                          |
| ---------------- | ---------- | ------------------------------------ |
| `testsDir`       | `string`   | Absolute path to the tests directory |
| `generatedFiles` | `string[]` | Paths of the generated spec files    |
| `projectDir`     | `string`   | Absolute path to the project root    |
| `errMessage`     | `string`   | Suggested error message prefix       |

---

## Utility functions

### `resolveTestProfile(id: string): TestProfile`

Looks up a profile by id. Throws a user-facing error listing all valid ids if the id is not recognised.

```typescript
import { resolveTestProfile } from 'src/test-profiles';
const profile = resolveTestProfile('python-pytest');
```

### `resolveTestScriptPath(profileId: SupportedProfileId): string`

Returns the absolute path to `test.sh` for the given profile. Used by the CLI as the default `--test-script` when no override is provided.

### `resolveTestDockerfilePath(profileId: SupportedProfileId): string`

Returns the absolute path to the `Dockerfile` for the given profile. Used when resolving the test-runner image.

---

## Constants

| Export                  | Value                                                                                                                                        | Description                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_TEST_PROFILE`  | `node-vitest` profile                                                                                                                        | Profile used when no `--test-profile` flag is given                                                                 |
| `SUPPORTED_PROFILE_IDS` | `['node-vitest', 'node-playwright', 'python-pytest', 'python-playwright', 'go-gotest', 'go-playwright', 'rust-rusttest', 'rust-playwright']` | All valid profile id strings — exported from `src/test-profiles/types.ts`, not from the main `index.ts` entry point |
| `SUPPORTED_PROFILES`    | `Record<SupportedProfileId, TestProfile>`                                                                                                    | Registry mapping every id to its `TestProfile` object                                                               |

---

## Adding a new profile

Open a PR that adds templates under `src/test-profiles/<new-id>/templates/`. The error thrown by `resolveTestProfile` includes this hint when an unknown id is passed.
