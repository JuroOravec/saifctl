# `release-readiness` — specification

This is the **what** — every concrete work item identified in the readiness
audit, grouped by component and severity, with file:line citations where
they exist. The **why** (release strategy, target audiences, risk model)
will live in `plan.md`. Per-phase implementation slices live in each
`phases/<id>/spec.md` once we cut phases.

This file is a **working document**. The first pass below is a verbatim
lift of the audit findings from the readiness conversation. Subsequent
passes will refine: prune duplicates, sharpen scope, attach decisions,
re-rank severity, and split into phase-shaped chunks. Treat anything not
yet marked `decided:` as still up for discussion.

---

## 0. Background

`saifctl` ships today at version `0.0.1` with a public-but-quiet npm
listing, a VS Code extension at `0.1.0` (unpublished to the marketplace),
a Next.js web site at `safeaifactory.com`, a generated docs tree, and
local Docker images built on demand. Multi-phase feature execution and
the critic layer have landed on `main`; the codebase is feature-rich
and the architectural
ambition (Cedar-policed Docker sandbox, three-stage convergence loop,
multi-language test profiles, multi-provider LLM config, multi-CLI agent
adapters) is **mostly real and not vaporware**. What's missing is the
release-grade polish: the kind of shape that holds up to a "show HN" or a
Twitter announcement without obvious cracks.

The audit scope was the union of:

- the npm package at `safe-ai-factory/`,
- the VS Code extension at `safe-ai-factory/vscode-ext/`,
- the web site at `safe-ai-factory/web/`,
- the docs tree at `safe-ai-factory/docs/`,
- the Docker tooling at `safe-ai-factory/scripts/docker.ts` and
  `src/sandbox-profiles/`,
- the integrations claimed in the README (LLM providers, agentic CLIs,
  languages, git providers, MCP, Hatchet, Mastra, S3, Cedar/Leash).

## 1. Goals (target state for this feature)

Two release tiers, captured separately so we can ship the first without
blocking on the second.

### 1.1 `v0.1` — credible alpha launch

The bar: a developer who lands on `safeaifactory.com`, installs the npm
package or VS Code extension, and runs the quickstart should reach a
green test in their first session **without hitting a documented gap, a
404'd link, or a feature that turns out to be a stub**. Marketing copy
matches reality. Headline integrations have at least one smoke test.
Public artifacts (npm, marketplace, web) are all consistent on names,
versions, and links.

### 1.2 `v1.0` — stable

The bar: external teams can adopt `saifctl` as the orchestration layer
for unattended overnight agent runs without us being on call. Cost
visibility, observability, distributed execution (Hatchet+resume),
self-hosted/Kubernetes deployment, and full agent-profile coverage are
all real and tested.

## 2. Non-goals

- **Re-architecting features that work.** The convergence loop, Cedar
  sandbox, run lifecycle, and provider/profile tables are sound; this
  feature is not where they get rewritten.
- **Killing the `dangerousNoLeash` mode** or the unrestricted-network
  default. Both are defensible design decisions. We adjust the _marketing
  copy_ to disclose them, not the defaults.
- **Bundling Argus inside the saifctl npm package.** Argus is its own
  product. We disclose the dependency or replace the reviewer step with
  an in-process implementation; we do not vendor a binary.
- **Reaching parity with proprietary products** (Cursor, Devin, Factory).
  saifctl's wedge is the safety harness + spec-driven loop, not feature
  count.

---

## 3. Findings — work items by component

**Severity scale:**

- **`B`** — blocker. Ships broken or actively misleading without this.
- **`I`** — important. Ships unpolished without this; not actively broken.
- **`N`** — nice-to-have. Cleans up rough edges; deferrable.

**Status scale:** (orthogonal to severity — answers "does this need a
conversation?" not "how bad is it?")

- **⚠️** — needs discussion. Multiple paths forward; user judgment required.
- **👍** — resolved. A decision has been made; see §5 for the rationale.
  Work pending.
- **🟠** — self-explanatory. The fix is mechanical; no design call to make.
  Work pending.
- **➡️** — deferred to `v1.0`. Out of scope for `v0.1`; revisit when the
  `v1.0` cycle starts. Lives in phase 11 (`11-v1-deferred`) of §9 by default.
- **✅** — completed. The work has actually shipped (commit landed,
  artifact published, etc.). Distinct from 👍 (decided but not yet done).

Each item is one row of the eventual phase plan. Items grouped by which
component they live in. New status changes propagate up to §5 (decisions
log) and trim §6 (open questions) accordingly.

### 3.0 Before you start — prerequisites & pending overview

Up-front block, two sub-sections: human-only items that gate
downstream phase work, and a reading-time map of what's still open.
Phases assume their blocking PREs are ✅ before they start; the
at-a-glance points at the row IDs in §3.1–§3.8 and §4 that own the
actual scope. Relocated from §8 on 2026-05-07; row IDs (`PRE-01`
…) unchanged.

#### 3.0.1 Human-only prerequisites

Items in this subsection require human action, external accounts, or
judgement calls and **cannot be completed by an AI agent**. An agent
hitting a blocked PRE during phase work should stop, not fabricate a
stand-in artifact (e.g. placeholder screenshot).

Status semantics:

- **🟠** — pending (human hasn't done it yet).
- **✅** — done. The blocked work items can now proceed.

<details open>
<summary>Show 12 prerequisites</summary>

| ID     | Status | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Blocks                                                                                   |
| ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------|
| PRE-01 | 🟠     | **Capture fresh screenshots and a short demo GIF/video** of (a) `saifctl` CLI on a real run, (b) the VS Code extension sidebar showing features and runs. Existing PNGs in `web/x_design/` are stale per WEB-06. Save under a _non-committed_ path the human chooses (e.g. `~/Pictures/saifctl-marketing/`); the AI agent will copy chosen frames into `web/public/` and `vscode-ext/resources/` once handed pointers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | NPM-05 (README line 88), VSX-07 (extension README hero), WEB-06, web saifctl page polish |
| PRE-02 | ✅     | **`@safe-ai-factory` npm org confirmed (2026-05-04)** — the successful manual publish of `@safe-ai-factory/saifdocs@0.1.0` (PRE-11 (a)) is the implicit evidence that the org exists and the maintainer has owner-level publish rights. The `NPM_TOKEN` secret is no longer required for saifdocs (uses Trusted Publishing per PRE-11 (b)); for saifctl the same migration is recommended (see PRE-11 saifctl follow-up).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | NPM-15 ✅, NPM-16 ✅, D-03                                                               |
| PRE-03 | 🟠     | **Set up the `safe-ai-factory` VS Code marketplace publisher.** Create the publisher entity in Azure DevOps, verify domain, generate the PAT to add as a GitHub Actions secret (`VSCE_PAT` — already referenced by `publish-extension.yml`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | VSX-09, first marketplace publish (phase 05)                                             |
| PRE-04 | 🟠     | **Configure GitHub Actions secrets / vars for the web deploy.** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` are validated by `publish-web.yml`. Also confirm the deploy target (Vercel? Static hosting?) and matching credentials.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | WEB-04, the web deploy itself                                                            |
| PRE-05 | 🟠     | **Resolve the remaining open questions** in §6 — Q-03 (Argus), Q-05 (web docs source), Q-06 (web launch scope), Q-08 (Windows), Q-09 (telemetry). Each one converts to a `D-NN` decision and unblocks specific work items.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | CLM-01, NPM-19 (argus path), WEB-02, WEB-05, sundry telemetry/Windows items              |
| PRE-06 | 🟠     | **Confirm `safeaifactory.com` DNS + production deploy target** are set up and pointed correctly. Web deploy will fail silently if the target is misconfigured.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | WEB-04, web launch                                                                       |
| PRE-07 | 🟠     | **Audit `web/x_design/` and clean it up by hand.** Walk each asset; decide what (if anything) gets kept / promoted to `web/public/` / moved to a private design folder / discarded. End state: the `web/x_design/` directory no longer exists in the working tree. Deliberately _not_ gitignored — keeping it discoverable until the human resolves it prevents an agent from reaching into stale design assets later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | WEB-06                                                                                   |
| PRE-08 | ✅     | **Submodule registration** for `vendor/saifbox` and `vendor/saifdocs`. **Saifdocs half done** (SDR-09 ✅, 2026-05-04: registered submodule pointing at `git@github.com:safe-ai-factory/saifdocs.git`). **Saifbox half resolved by D-20** (Q-11): no submodule registration needed — saifbox is being folded into saifctl as Sandbox mode and `vendor/saifbox/` will be deleted as part of WEB-08 cleanup. PRE complete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | WEB-02, NPM-18, VND-03, VND-04                                                           |
| PRE-09 | ✅     | **Transferred both vendor forks** to the `safe-ai-factory` GitHub org on 2026-05-04. **(a) `argus`**: `JuroOravec/argus` → `safe-ai-factory/argus`. References updated: `.gitmodules`, `REPO` constant in `src/orchestrator/sidecars/reviewer/argus.ts:34`, header comment, `vendor/README.md` instructions. Releases survived the transfer (verified via HEAD on the v0.5.6 musl asset). **(b) `leash`** (added later, per D-16 / VND-02 expanded scope): `JuroOravec/leash` → `safe-ai-factory/leash`. References updated: `.gitmodules`, `DEFAULT_LEASH_IMAGE` in `src/constants.ts:131`, comment block, `vendor/README.md`. **GHCR Docker image** (separate from GitHub repo transfer — GHCR is a separate registry not auto-moved by repo transfer): rebuilt + pushed multi-arch (linux/amd64 + linux/arm64) at `ghcr.io/safe-ai-factory/leash:latest-h2patch` + sha-tagged variant; image pulls cleanly. Required a new PAT with `write:packages` scope for the org. | VND-01 ✅, VND-02 ✅; D-03 alignment                                                     |
| PRE-10 | ✅     | **`safe-ai-factory/saifdocs` GitHub repo created (2026-05-04, by user).** Repo created via GitHub UI with an auto-generated LICENSE-only initial commit. After this, agent did SDR-08 (force-pushed the refactored saifdocs content) and SDR-09 (registered as submodule in parent saifctl repo).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | SDR-08 ✅, SDR-09 ✅                                                                     |
| PRE-11 | ✅     | **First saifdocs publish + npm Trusted Publishing setup — both done (2026-05-04).** (a) `@safe-ai-factory/saifdocs@0.1.0` published manually from local CLI; PRE-02 (npm org `@safe-ai-factory`) implicitly resolved by the successful publish. (b) Trusted Publisher configured on npmjs.com pointing at `safe-ai-factory/saifdocs` + `.github/workflows/publish-npm.yml`. From now on, every release-trigger on saifdocs publishes via OIDC + provenance, no stored secret. Smoke-tested: `npx -y @safe-ai-factory/saifdocs --help` works end-to-end against the published package.                                                                                                                                                                                                                                                                                                                                                                                      | VND-04 ✅                                                                                |
| PRE-12 | ✅     | **Saifctl OIDC migration — both bootstrap steps done (2026-05-04).** Workflow at `.github/workflows/publish-npm.yml` (commit `bf685a6`) carries `permissions: id-token: write`, `--provenance`, `./` path prefix, and bootstrap header comment. (a) `@safe-ai-factory/saifctl@0.1.0` published manually from local CLI. (b) Trusted Publisher configured on npmjs.com pointing at `safe-ai-factory/saifctl` + `.github/workflows/publish-npm.yml`. From now on, every release-trigger publishes via OIDC + provenance — no stored secret. The `NPM_TOKEN` repo secret is now dead weight and can be removed.                                                                                                                                                                                                                                                                                                                                                               | NPM-15 ✅, NPM-16 ✅                                                                     |

</details>

How prerequisites interact with phases:

- Each phase in §9 implicitly assumes its blocking PREs are ✅ before
  the phase starts. If you start a phase with pending PREs, expect a
  hard stop midway through — the agent will reach the blocked item
  and have nothing to work with.
- Mark a PRE ✅ as soon as the human action is complete; the next
  phase-runner picks up the unblock.
- New PREs may surface during phase execution (e.g., "we need a new
  GitHub Actions secret no one mentioned yet"). Add them here, mark
  blocking, escalate immediately.

#### 3.0.2 At-a-glance — pending work areas (`v0.1`)

A reading-time map of the remaining work, by area. Each bullet points
at the row IDs in §3.1–§3.8 and §4 that own the actual scope; this
section is **not** a third source of truth, just a navigation aid for
when the per-component tables get long. Updated 2026-05-07.

**saifctl (npm package + CLI):**

- **Publish v0.1** — version bump, first tagged release on the
  `@safe-ai-factory` org. Plumbing is ready (PRE-12 ✅); pulling the
  trigger is the only remaining npm work for v0.1. (NPM-15, NPM-16.)
- All other npm-package work — coverage uplift, orchestrator state
  refactor, planning-files cleanup — relocated to §4 (X-08-P4, X-09,
  X-10) and §3.4 (DOC-10) on 2026-05-07 because they're cross-cutting
  or doc-shaped, not npm-package-shaped.

**VS Code extension:**

- **Pick the canonical README** out of the three that ship today.
  (VSX-01.) Editorial call held for human review.
- **README polish** — replace placeholder screenshots/GIFs with real
  assets. (VSX-07; depends on PRE-01 fresh capture.)
- **Activation + compat probe** — set `activationEvents`, ship the
  `MIN_CLI_VERSION` activation probe. (VSX-04, VSX-11.)
- **Smoke-test the 48 commands** against an actual workspace. (VSX-08.)
- **Cleanup** — already largely done (VSX-02, VSX-05, VSX-10 ✅).
- **Publish v0.1 to the marketplace** — needs PRE-03 (publisher entity
  + PAT). (VSX-06, VSX-09.)

**Web (`safeaifactory.com`):**

- **Full review needed** — site has had piecemeal edits but no
  end-to-end pass since the saifbox→Sandbox-mode fold (WEB-08 ✅) and
  D-20.
- **Deploy** — env vars + DNS + production target. (WEB-04, PRE-04,
  PRE-06.)
- **Surface saifdocs-built docs in web** — sync-docs depends on the
  saifdocs gen happening. (Q-05 / WEB-02.)
- **Marketing claims sweep** — TODO comments + marketplace placeholder
  on the saifctl page; saifdocs page treatment; tagline. (WEB-03,
  WEB-05, WEB-09.)
- **Stale design assets cleanup** — human-only audit. (PRE-07 → WEB-06.)

**Marketing-vs-reality (README + web + docs):**

- CLI count claim, vocabulary glossary, provider claim sweep across
  surfaces. (CLM-03, CLM-04, CLM-06.) "Zero-trust" copy
  rephrase decided but the sweep is pending. (CLM-05.)

**Docs:**

- **Top-level README sweep** — broken links, three TODO markers,
  broader rewrite. (DOC-01.) Absorbs the prior NPM-05 and the README
  half of DOC-09.5.
- **Generate** — run `saifdocs gen` + `saifctl feat run` to populate
  `docs/`. User-driven (LLM credentials + Docker + cost). (DOC-09.4.)
- **CHANGELOG dated entry** — first public release entry. (DOC-06.)
- **Optional** — FAQ / SUPPORT / ROADMAP. (DOC-07.)
- **Deferred** — top-level planning files cleanup. (DOC-10, former
  NPM-10.)

**Cross-cutting (§4):**

- **Tests + coverage** — 70% threshold uplift on critical paths
  (X-08-P4, former NPM-07); rides on the X-08 harness. Smoke matrix
  (X-01) and provider-invocation tests (X-04) ride on the same
  harness.
- **Cost & token observability** — `saifctl run get` should show
  spend per run. (X-02.)
- Deferred to v1.0: OTel/Sentry export (X-03), shotgun packaging
  unification (X-05), Helm chart (X-06), `saifctl validate` linter
  (X-07), orchestrator state refactor (X-09, former NPM-08), 98%
  coverage uplift (X-10, former NPM-20).

---

### 3.1 npm package (`safe-ai-factory/`)

<details open>
<summary>Show 21 work items</summary>

| ID     | Sev | Status | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Citation                                                                                                 |
| ------ | --- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| NPM-01 | B   | ✅     | Self-referential `devDependency` `@safe-ai-factory/saifctl: file:.../safe-ai-factory-saifctl-0.0.1.tgz`. Breaks `npm publish` and any clean install. ~~Remove.~~ Removed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `package.json:154`                                                                                       |
| NPM-02 | B   | ✅     | 4.7 MB tarball `safe-ai-factory-saifctl-0.0.1.tgz` was in the working tree (not tracked in git, but unignored). Tarball deleted; `*.tgz` added to root `.gitignore`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `.gitignore`, removed tarball                                                                            |
| NPM-03 | B   | ✅     | `Hatchet + 'run resume'` actively throws. **Decision D-04.** **Resolved:** added `assertHatchetReady(isLocal)` helper at the entry to the Hatchet branch — when `HATCHET_CLIENT_TOKEN` is set without `SAIFCTL_EXPERIMENTAL_HATCHET=1`, throws the new D-04 message ("Hatchet integration is not yet available in v0.1.0…"). Local mode (`LocalHatchetRunner`) is unaffected. The inner resume guardrail at the formerly-inverted `if (!opts.fromArtifact?.pausedSandbox)` condition was flipped to fire correctly only on the `pausedSandbox` resume case (latent inversion bug); the original "Hatchet + 'run resume' path does not work yet." message is preserved as the narrower experimental-path guardrail. `doctor` updated to a three-state check (no token / token-without-flag / token-with-flag). New 6-case unit test in `modes.hatchet-gate.test.ts` (passing). | `src/orchestrator/modes.ts`, `src/cli/commands/doctor.ts`, `src/orchestrator/modes.hatchet-gate.test.ts` |
| NPM-04 | B   | ✅     | Node version inconsistency. **Decision D-09:** target **Node 22 (LTS)**. **Resolved:** `package.json` engines bumped from `>=20` to `>=22.0.0`; CI workflows updated — `tests.yml`, `publish-npm.yml`, `publish-images.yml` (×2 jobs) moved from Node 25 → 22; `publish-web.yml` moved from Node 20 → 22. README "Requirements" line was already "Node.js 22+".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `package.json:25`, `.github/workflows/{tests,publish-npm,publish-images,publsh-web}.yml`                 |
| NPM-05 | B   | ✅     | **Closed 2026-05-07; remaining work folded into DOC-01.** Originally tracked the three README TODO markers at lines 87, 88, 114 (marketplace link, screenshot/GIF embed, spec-driven-development.md link) per **Decision D-10**. Closing the row because the README is being rewritten under DOC-01 anyway — handling the same three TODOs there as one piece of broader README work avoids splitting the same edit across two rows. D-10's "fill in, don't remove" stance is preserved on DOC-01.                                                                                                                                                                                                                                                                                                                                                                                          | `README.md:87-88,114` → DOC-01                                                                           |
| NPM-06 | I   | ✅     | Drop 15 of 19 `@ai-sdk/*` provider deps; keep `@ai-sdk/{anthropic,google,google-vertex,openai}`. **Decision D-05.** **Resolved:** `PROVIDERS` table refactored to a tagged union (`kind: 'native' \| 'openai-compat'`); `createProviderModel()` dispatches to the native SDK for the four kept providers and routes everything else through `@ai-sdk/openai` with each provider's documented OpenAI-compatible `baseURL`. **Vercel V0 dropped entirely** (no clean OpenAI-compat surface). Latent bug fixed in passing: Anthropic was missing from `PROVIDER_LOOKUP` (no `aliases` entry, so resolution silently fell to the OpenAI-compat fallback) — added `aliases: ['anthropic']`. 4 unit tests added for dispatch paths; 2 env-gated live smoke tests added (`LLM_SMOKE=1`, Anthropic + OpenRouter). All 759 tests green; `pnpm install` confirmed −16 packages.         | `package.json`, `src/llm-config.ts`, `src/llm-config.test.ts`, `src/llm-config.smoke.test.ts`            |
| NPM-07 | I   | ✅     | **Closed 2026-05-07; relocated to X-08-P4.** Coverage uplift is integration-harness work, not npm-package work; folding it into the X-08 phase plan keeps the prerequisite chain visible (P1+P2 stable for ≥1 week → P4 raises the floor). Original scope unchanged: 70% on orchestrator, CLI, sandbox engine, the four kept providers from D-05. The 98% target now lives at **X-10** (was NPM-20). **Decision D-07.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `vitest.config.ts:13-20` → X-08-P4                                                                       |
| NPM-08 | I   | ✅     | **Closed 2026-05-07; relocated to X-09.** The orchestrator-state refactor is cross-cutting infrastructure (it gates Hatchet, which is itself cross-cutting per D-04), not a per-package concern. Lives in §4 from now on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `src/orchestrator/loop.ts:676-681` → X-09                                                                |
| NPM-09 | B   | ✅     | Remove `dist-pack/` from git history and add to `.gitignore`. The directory is a transient output for `scripts/package.sh` (local-verification path: `pnpm build && npm pack --pack-destination dist-pack/`); the _script_ keeps using it, but the contents must not be tracked. **Part of Decision D-08** (repo-root dir taxonomy). Originally bundled four dirs with mixed rationale; split into NPM-09 / NPM-17 / NPM-18 / NPM-19. **Verified during tier-1 cleanup:** `dist-pack/` was already in `.gitignore` (line 4) and had nothing tracked — no action required.                                                                                                                                                                                                                                                                                                     | `.gitignore:4`, `scripts/package.sh`                                                                     |
| NPM-10 | I   | ✅     | **Closed 2026-05-07; relocated to DOC-10.** Author-internal markdown housekeeping is documentation hygiene, not npm-package hygiene — fits cleanly under §3.4 alongside the rest of the doc-cleanup work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | repo root → DOC-10                                                                                       |
| NPM-11 | N   | ✅     | `console.warn` in library code at `src/hatchet/utils/local.ts:244`. Route through the configured logger or remove. **Resolved:** added `import { consola } from '../../logger.js'` and replaced `console.warn` with `consola.warn`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `src/hatchet/utils/local.ts`                                                                             |
| NPM-12 | N   | ✅     | The `"./package.json": "./package.json"` export is **not redundant** — it's the standard pattern (used by React, Vite, Vue, etc.) for letting downstream code read version metadata via package-name resolution. **Decision D-11:** keep the export. Investigation found saifctl's own `getSaifctlPackageVersion()` reads via filesystem (bypassing the exports map at `src/constants.ts:24`), and `vendor/saifdocs/src/generation/run-sandbox.ts:22-25` had a stale comment claiming the export "is not listed in exports" — comment removed. Export retained.                                                                                                                                                                                                                                                                                                               | `package.json:34`, `vendor/saifdocs/src/generation/run-sandbox.ts`                                       |
| NPM-13 | N   | ✅     | Add `.npmignore` as defense-in-depth alongside the `files` array. **Resolved:** created `.npmignore` excluding tests, dev tooling, planning docs, CI/repo hygiene, build outputs, OS junk, and the `npm-tombstones/` dir. The `files` allowlist remains the primary mechanism; `.npmignore` is the safety net if `files` is ever removed/modified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `.npmignore`                                                                                             |
| NPM-14 | I   | ✅     | Unify publish to **one flow**: `bash scripts/package.sh` then `npm publish ./dist-pack/...tgz`. **Resolved:** dropped `"prepublishOnly": "npm run build"` from `package.json`; updated `.github/workflows/publish-npm.yml` step from `npm publish --access public` to `npm publish ./dist-pack/safe-ai-factory-saifctl-*.tgz --access public` (publishes the verified tarball directly; `./` prefix forces file-path interpretation, otherwise npm misreads as a GitHub shortcut). What runs locally is bit-identical to what ships. **Decision D-11.**                                                                                                                                                                                                                                                                                                                       | `package.json`, `.github/workflows/publish-npm.yml`                                                      |
| NPM-15 | B   | 👍     | First public release tag is `v0.1.0`. Bump `package.json` from `0.0.1` and add a dated `## 0.1.0 — YYYY-MM-DD` entry to `CHANGELOG.md`. **Decision D-01.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `package.json`, `CHANGELOG.md`                                                                           |
| NPM-16 | B   | 👍     | Publish under the `@safe-ai-factory` org account, not personal. Verify `publishConfig.access: public` (already set) and confirm npm org+permissions before first publish. **Decision D-03.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `package.json:5-7`                                                                                       |
| NPM-17 | B   | ✅     | `npm-tombstones/` are defensively-parked package names. **Resolved:** `npm-tombstones/README.md` was already substantive (2479 bytes documenting rationale, publish order, and per-tombstone commands); Section 1 (real package publish flow) was updated to match Decision D-11. `npm-tombstones/` added to `.npmignore` as defense-in-depth (it was already excluded from the tarball via the `files` allowlist; explicit ignore is the belt-and-suspenders). **Part of Decision D-08.**                                                                                                                                                                                                                                                                                                                                                                                    | `npm-tombstones/README.md`, `.npmignore`                                                                 |
| NPM-18 | B   | ✅     | **Resolved 2026-05-05 as part of DOC-09.2.** All 112 `docs_old/` files migrated and `docs_old/` deleted (verified absent in working tree). New artefacts: `docs/contributing/` (9 handwritten internal docs + `architecture-history/` later restructured into `architecture/` per DOC-09.6, with 11 focused docs); `docspec/` populated with concepts, references, how-tos, tutorials, personas, tasks, assets. The transplant-audit evidence lives in [`docs-migration.md`](safe-ai-factory/saifctl/features/release-readiness/docs-migration.md) (per-file mapping) — closes the original "open: who runs the audit" question.                                                                                                                                                                                                                                                                              | `docs_old/` (deleted), `docs/contributing/`, `docspec/`                                                  |
| NPM-19 | B   | ✅     | **Closed 2026-05-07.** `vendor/` umbrella row. Originally bundled all 5 subdirs as one item; **Decision D-12** split it into per-subdir work items in §3.7 (VND-01..VND-05). All five VND children are ✅. The only follow-up — VND-06 (migrate saifctl back to upstream `Meru143/argus` once their PR merges and ships binaries) — is tracked there as ➡️ deferred. Nothing remains to track on the umbrella row itself.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `vendor/`, `.gitmodules`                                                                                 |
| NPM-20 | I   | ✅     | **Closed 2026-05-07; relocated to X-10.** Coverage uplift is integration-harness work, not npm-package work — same reasoning as NPM-07's move to X-08-P4. **Decision D-07** still applies; the 98% v1.0 target lives at X-10 from now on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `vitest.config.ts:13-20` → X-10                                                                          |
| NPM-21 | I   | ✅     | **README "Two modes" section** per **Decision D-20**. Shipped 2026-05-07 between the "Read more on Security & Isolation" line and "The Gauntlet" section. Outcome-led copy per the user-facing-copy memory: H2 "Two modes: Sandbox and Factory", subhead "Same container either way.", one short paragraph per mode + one CLI line + tutorial link (Sandbox → `tutorials/first-sandbox-run.md`, Factory → `tutorials/spec-driven-development.md`).                                                                                                                                                                                                                                                                  | `README.md`                                                                                              |

</details>

### 3.2 VS Code extension (`safe-ai-factory/vscode-ext/`)

<details open>
<summary>Show 11 work items</summary>

| ID     | Sev | Status | Item                                                                                                                                                                                                                                                                                                                                                                                                       | Citation                                                         |
| ------ | --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| VSX-01 | B   | ⚠️     | Three competing READMEs ship inside the `.vsix`: `README.md`, `README_bacup.md` (typo), `README_v2.md`. Pick the canonical one, delete the others, or `.vscodeignore` them. **Editorial call — held for human review** before mechanical execution; the contents of `README_v2.md` may be the better starting point and the choice should not be made by an agent.                                         | `vscode-ext/README*.md`                                          |
| VSX-02 | B   | ✅     | `saifac-test-workspace/` (typo'd dir, old project name) is **needed for live extension testing** — `vscode-ext/src/test/runTest.ts:20` already references the new path `saifctl-test-workspace`. **Resolved:** `git mv` performed, dir is now `saifctl-test-workspace/`; `saifctl-test-workspace/**` added to `vscode-ext/.vscodeignore` so it stays out of the published `.vsix`.                         | `vscode-ext/saifctl-test-workspace/`, `vscode-ext/.vscodeignore` |
| VSX-03 | B   | ✅     | No `CHANGELOG.md`. Marketplace renders it on the listing. **Resolved:** created `vscode-ext/CHANGELOG.md` with Keep-a-Changelog format and an initial `[0.1.0]` entry covering the sidebar features (tree view, run actions, diff inspection, chat timeline, key management, goto-feature) plus a Compatibility section noting the `MIN_CLI_VERSION` probe (per VSX-11 / D-02) and VS Code engine range.   | `vscode-ext/CHANGELOG.md`                                        |
| VSX-04 | I   | ⚠️     | `activationEvents: []`. Verify intent — should be `onView:saifctl-explorer` and/or specific `onCommand:` triggers, not empty.                                                                                                                                                                                                                                                                              | `vscode-ext/package.json:41`                                     |
| VSX-05 | I   | ✅     | `.vscodeignore` did not exclude `pnpm-lock.yaml` (~222 KB) and `*.tgz` (~216 KB). **Resolved:** added `pnpm-lock.yaml`, `**/*.tgz`, and `**/*.vsix` to `vscode-ext/.vscodeignore`.                                                                                                                                                                                                                         | `vscode-ext/.vscodeignore`                                       |
| VSX-06 | I   | 👍     | Marketplace launch version: `0.1.0` (matches CLI's first public release). Extension and CLI track independent SemVer trains thereafter. **Decision D-02.**                                                                                                                                                                                                                                                 | `vscode-ext/package.json`                                        |
| VSX-07 | I   | 🟠     | README hero block contains placeholder HTML comments for screenshots/GIFs. Replace with real assets or remove the placeholders.                                                                                                                                                                                                                                                                            | `vscode-ext/README.md`                                           |
| VSX-08 | I   | ⚠️     | Smoke test the 48 `contributes.commands` against an actual workspace. Each has a `registerCommand` callsite, but no integration test exercises the user flows the README advertises ("Manage Features", "Track Runs", etc.).                                                                                                                                                                               | `vscode-ext/src/`                                                |
| VSX-09 | N   | 👍     | Publisher: `safe-ai-factory` (org account), not `JuroOravec` (personal). Coordinate with NPM-16. **Decision D-03.**                                                                                                                                                                                                                                                                                        | `vscode-ext/package.json`                                        |
| VSX-10 | N   | ✅     | Stale build artifacts in `vscode-ext/`: `saifctl-0.0.1.vsix`, `saifctl-0.1.0.vsix`, `saifctl-0.0.1.tgz`. **Resolved:** all three deleted (they were not git-tracked; future builds will regenerate). Working tree clean. Future build outputs should land in `vscode-ext/dist/` — out of scope for this row.                                                                                               | `vscode-ext/`                                                    |
| VSX-11 | I   | 👍     | **CLI version compatibility probe at activation.** Extension declares a `MIN_CLI_VERSION` (or `cliCompat: "^X.Y.Z"`) constant; on activation, shells `saifctl --version`, parses, compares against the declared range. On mismatch, surfaces a modal: "saifctl ≥ X.Y.Z required" with one-click install/upgrade action. **Decision D-02** specifies the versioning model; this is the implementation slot. | new file in `vscode-ext/src/`                                    |

</details>

### 3.3 Web site (`safe-ai-factory/web/`)

<details open>
<summary>Show 8 work items</summary>

| ID     | Sev | Status | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Citation                                                                                      |
| ------ | --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| WEB-01 | B   | ✅     | Product `nav.json` files were empty stubs — the deploy workflow validates their non-emptiness. After **Decision D-20** (saifbox folds into saifctl), the saifbox nav.json drops out entirely; remaining work covers `web/src/content/docs/{saifctl,saifdocs}/nav.json`. The saifbox docs content relocates under `web/src/content/docs/saifctl/sandbox/` and its nav entries fold into the saifctl nav (tracked under WEB-08). **Resolved 2026-05-08:** both nav.jsons populated end-to-end. Saifctl side from earlier `saifdocs gen` + `saifctl feat run` against `safe-ai-factory/docspec/` (24 generated pages under `docs/products/saifctl/`); saifdocs side from today's run against `vendor/saifdocs/docspec/` (13 generated pages + landing under `vendor/saifdocs/docs/products/saifdocs/`). `web/scripts/sync-docs.ts` rebuilt both `nav.json` files with the full section ladder (Overview / Tutorials / How-tos / Concepts / Reference where applicable). Deploy gate now satisfied. | `web/src/content/docs/{saifctl,saifdocs}/nav.json`, `.github/workflows/publish-web.yml:56-66` |
| WEB-02 | B   | ✅     | `vendor/saifdocs` and `vendor/saifbox` are not registered submodules in `.gitmodules`, but `web/scripts/sync-docs.ts` reads from them. CI clones won't have content; `nav.json` stays empty. **Resolved:** saifbox folded out of `sync-docs.ts` per **VND-03** (no longer read — SOURCES + filterEntriesForProduct + absPathToWebUrl branches all stripped); `vendor/saifdocs` registered as a submodule per **SDR-09** (2026-05-04, `git@github.com:safe-ai-factory/saifdocs.git`, branch on `vendor/saifdocs/v0.3.1-2-g9c924db`). CI clones now hydrate the saifdocs source via `git submodule update --init --recursive` — confirmed via local `git submodule status`. | `.gitmodules`, `web/scripts/sync-docs.ts`                                                     |
| WEB-03 | B   | ⚠️     | The saifctl product page has 12 inline TODOs, a visible `[ screenshot / recording placeholder ]` (line 1029), and the marketplace link is the literal string `'#TODO-vscode-marketplace'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `web/src/app/saifctl/page.tsx:30,141-150,1029`, `web/src/app/constants.ts`                    |
| WEB-04 | B   | 🟠     | Required env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`) are not clearly configured in GitHub Actions. Plausible validation in the workflow can fail silently.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `.github/workflows/publish-web.yml:52-54,68-75`                                               |
| WEB-05 | I   | 👍     | The saifbox and saifdocs product pages were both 130 / 115-line skeletal stubs. **Saifbox half**: page is being deleted per **Decision D-20** (saifbox folds into saifctl as Sandbox mode); `/saifbox` URL gets a Next.js redirect to `/saifctl#sandbox` to preserve inbound links. **Saifdocs half**: still ⚠️ — flesh out (fits with D-17/D-18 saifdocs publish posture) or mark "coming soon" cleanly. Open subtask: pick saifdocs page treatment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `web/src/app/saifdocs/page.tsx`                                                               |
| WEB-06 | B   | 👍     | `web/x_design/` contents are **stale** — the app has changed substantially since those PNGs were captured, so they cannot be used as-is. **Do not gitignore.** The human will audit the directory, decide per-asset what (if anything) to keep / move / discard, and clean it up themselves so no agent ever reaches into stale design assets. End state: `web/x_design/` no longer exists. Tracked as **PRE-07**. Fresh captures (separate work) live under **PRE-01**, feeding D-10 (line 88) and VSX-07 (extension README).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `web/x_design/`, `web/plan.md`                                                                |
| WEB-07 | N   | ✅     | `web/out/` (static export) was reported as committed and stale. **Verified during tier-1 cleanup:** `web/.gitignore:5` already lists `out/`, and `git ls-files web/out/` returns empty — nothing tracked. No action required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `web/.gitignore:5`                                                                            |
| WEB-08 | B   | ✅     | **Saifbox → Sandbox-mode fold** across the web surface (per **Decision D-20**). Shipped 2026-05-07. Final outcome diverged from the original 9-step plan in three places: (a) saifctl/page.tsx kept the existing hero unchanged and added a NEW "Two modes" section right below it (per user's "don't replace the hero" guidance) — twin 50/50 cards, copy rewritten to be outcome-led per the user-facing-copy memory ("Run an agent. Or build a feature." / "Same container either way." / Sandbox + Factory cards each with one CLI example + tutorial CTA); (b) no `/saifbox` redirect added — user wanted "pretend saifbox never existed"; (c) `web/src/content/docs/saifbox/` was auto-cleaned by sync-docs once the source disappeared (no manual file moves needed; the docspec merge fed the new sandbox content into saifctl's normal generation pipeline). All other steps shipped as planned: Home.tsx 3→2 cards, Nav/Footer saifbox links removed, `DOC_PRODUCTS` trimmed, sync-docs SOURCES + branches stripped, page tagline metadata updated. Bonus: `transformHtmlComments()` added to sync-docs.ts to convert HTML comments → MDX-safe comments (was breaking `npm run build` prerender). | `web/src/{app,components,content,lib,scripts}/`, `web/next.config.ts`                         |
| WEB-09 | N   | 👍     | Update hero to "Define workflows for coding agents".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | TBD                                                                                           |

</details>

### 3.4 Docs (`safe-ai-factory/docs/` and references)

<details open>
<summary>Show 10 work items</summary>

| ID     | Sev | Status | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Citation                                                                                    |
| ------ | --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| DOC-01 | B   | 🟠     | **Top-level README sweep** (broadened scope as of 2026-05-07; absorbs prior NPM-05 and the README half of DOC-09.5). Three buckets: (a) **broken links** — README pointed at `docs/spec-driven-development.md`, `docs/usage.md`, `docs/guides/README.md`, `docs/features.md`, `docs/config.md` while live content lived in `docs_old/`; an initial pass at remapping the 17 broken `docs/` links to forward-compatible saifdocs-output paths is sitting unstaged in the working tree as a starting point. (b) **TODO markers** (was NPM-05) — three `<!-- TODO -->` markers in the README at lines 87, 88, 114 per **Decision D-10**: marketplace link (resolves once VSX-09 + first marketplace publish ship), embed video/screenshot (depends on PRE-01 fresh-capture), and the `docs/spec-driven-development.md` link (resolved by DOC-08 — already authored under `docspec/products/saifctl/tutorials/spec-driven-development.md`; just needs the saifdocs gen/run from DOC-09.4 to surface in `docs/`). (c) **broader rewrite scope** — user signalled the README itself wants more substantive work than just link replacement. | `README.md`, `docs/`                                                                        |
| DOC-02 | I   | ✅     | **Resolved as part of DOC-09 (2026-05-05).** `docs/references/commands/` now ships 9 top-level command pages — `cache.md`, `doctor.md`, `feat.md` (covers `feat new`, `feat design*`, `feat run`, `feat phases` as in-page sections per the locked DOC-09 decision to keep subcommands inline with their parent's source file), `feat-phases.md`, `init.md`, `run.md` (covers all 15 `run *` lifecycle subcommands as a table + per-subcommand sections), `run-rules.md`, `sandbox.md`, `version.md`. Plus reference docs for agents, designers, indexers, sandbox profiles, test profiles, models, env vars, storage, etc. The original "20 commands missing" gap is closed.                                                                                                                                                                                                                                                | `docs/references/commands/`                                                                 |
| DOC-03 | I   | ✅     | **Resolved 2026-05-07.** Substantive contributor guide shipped under `docs/contributing/` as part of DOC-09.6 (2026-05-06) — `architecture/` (11 focused docs with file:line anchors into `src/`) plus per-subsystem pages (`cli-architecture.md`, `adding-agents.md`, `docker.md`, `hatchet.md`, `infra.md`, `agent-logs.md`, `agent-profile-options.md`, `inner-round-stats.md`, `logging.md`, `branding.md`, `documentation.md`). Top-level `CONTRIBUTING.md` rewritten on 2026-05-07: stale `docs/development/` pointer flipped to `docs/contributing/`; thin sections added for bug reports, feature proposals (with pointer to spec-driven-development tutorial), dev setup (Node 22 + pnpm + Docker + submodule init + `pnpm run check`), branch + PR conventions (table form), and code style (pointers to `.editorconfig` / `.prettierrc` / `eslint.config.js` / `pnpm run check`). Repo root entry-point now routes contributors into the rich `docs/contributing/` tree instead of dead-ending.                                                                                                                                                                                                                                                                       | `CONTRIBUTING.md`, `docs/contributing/`                                                     |
| DOC-04 | I   | ✅     | `SECURITY.md` (14 lines) was bare. **Decision D-06** specified the long-form doc. **Resolved 2026-05-04 alongside DCK-02 / DCK-04:** content shipped at [`docs_old/security.md`](safe-ai-factory/docs_old/security.md) (replacing the prior marketing-overclaim version) with all five required sections (protections, gaps, filesystem-as-boundary rationale, Cedar override surface listing all three bundled policies, `dangerousNoLeash` mode) plus an Auditability section preserving the Leash dashboard pointer. **Note on location:** content lives in `docs_old/` because `docs/` is auto-generated by saifdocs and the saifdocs migration is in flight; the eventual transplant to `vendor/saifdocs/docspec/` is tracked as part of NPM-18. Top-level `SECURITY.md` already kept just the GitHub Security Advisory pointer (no GPG fingerprint surfaced; using GHSA workflow is acceptable for v0.1) — left as-is. | `SECURITY.md`, `docs_old/security.md`                                                       |
| DOC-05 | I   | ✅     | `docs/security.md` and `docs/leash-access-control.md` were referenced from the README but the auto-generated `docs/` tree was empty. **Resolved 2026-05-04:** both shipped under `docs_old/` (the staging area until the saifdocs migration completes — see NPM-18). `docs_old/security.md` per DOC-04. [`docs_old/leash-access-control.md`](safe-ai-factory/docs_old/leash-access-control.md) (existing 338-line working doc, retained as-is) covers the Cedar action vocabulary (`FileOpen`, `FileOpenReadWrite`, `ProcessExec`, `NetworkConnect`), policy syntax (forbid-beats-permit, `Dir::"…/"` matching, `Host::"…"` allowlists), bundled policies, the `--cedar` flag, custom-policy recipes, and pointers to the upstream Leash CEDAR spec. README links updated to `docs_old/`.                                                                                                                                    | `README.md`, `docs_old/leash-access-control.md`                                             |
| DOC-06 | I   | 🟠     | `CHANGELOG.md` "Unreleased" is healthy (~22 entries) but no released versions are dated. First public release needs a real version+date entry. (Coordinate with NPM-15.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `CHANGELOG.md`                                                                              |
| DOC-07 | N   | ⚠️     | No FAQ, no SUPPORT, no ROADMAP file. Roadmap is a GitHub Project; FAQ/SUPPORT would absorb the "how does the sandbox actually work" / "what providers are supported" / "what about Windows" questions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | n/a                                                                                         |
| DOC-08 | B   | ✅     | **Authored as a tutorial** at [`docspec/products/saifctl/tutorials/spec-driven-development.md`](safe-ai-factory/docspec/products/saifctl/tutorials/spec-driven-development.md) (2026-05-05, as part of DOC-09.3). Decision: tutorial (not concept, not split) — the page is a progressive-disclosure walkthrough of the feature directory layout, distinct from the existing goal-oriented `spec-to-pr` tutorial. Per Decision D-10 the body intent walks the user through building a feature from an empty dir, adding files in the order they're needed, with cross-links to `SKILL.md`, `_phases-example/`, and `_phases-and-critics/` for depth. Tone: explanatory for evaluators, not prescriptive for agents. Generated page lands at `docs/products/saifctl/tutorials/spec-driven-development.md` once saifdocs runs (DOC-09.4).                                                                                      | `docspec/products/saifctl/tutorials/spec-driven-development.md`                             |
| DOC-09 | B   | 👍     | **End-to-end migration** consolidating DOC-01 / DOC-02 / NPM-18. **DOC-09.1, .2, .3, .5, .6 all ✅** as of 2026-05-06; the broader top-level README sweep that originally rode under DOC-09.5 was moved into **DOC-01**. **DOC-09.4 (saifdocs gen + saifctl feat run)** is user-driven (LLM credentials + Docker + cost) and remains 🟠. See §3.4.1 for sub-IDs and [`docs-migration.md`](safe-ai-factory/saifctl/features/release-readiness/docs-migration.md) for the per-file audit.                                                                                                                                                                                                                                                                                                                                                                                                                                 | `docs/`, `docs_old/` (deleted), `docspec/`, `README.md`, `.github/workflows/tests-docs.yml` |
| DOC-10 | I   | ➡️     | **Top-level planning files cleanup.** Stray author-internal markdown notes at the repo root (`TODO_*.md`, `INBOX.md`, `plan.md`, `todo_diff_storage*.md`). Already excluded from the npm tarball via the `files` array in `package.json`, so not "shipped" — but visible in the public git repo. Defer to `v1.0` housekeeping. Relocated from NPM-10 on 2026-05-07 (doc hygiene, not package hygiene).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | repo root                                                                                   |

</details>

### 3.4.1 Docs migration plan (DOC-09)

The `docs/`, `docs_old/`, and `docspec/` situation has accumulated three overlapping problems: stale agent-generated pages committed to `docs/`, 112 hand-written legacy files in `docs_old/` with no clear migration path, and a `docspec/` that covers <10% of the actual product surface. DOC-09 tracks the consolidated cleanup. Sub-steps:

<details open>
<summary>Show 6 work items</summary>


| Sub-ID   | Sev | Status | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Output                                                                                                                                                                                                                                                                                                                    |
| -------- | --- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOC-09.1 | B   | ✅     | **Empty `docs/`.** Audit each file currently in `docs/`. Port unique content to `docs_old/` (staging area for DOC-09.2) or delete agent-accidental output that the docspec entries will regenerate. End state: `docs/` is empty.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `docs/` (cleaned)                                                                                                                                                                                                                                                                                                         |
| DOC-09.2 | B   | ✅     | **Migration complete (2026-05-05).** All 112 `docs_old/` files migrated and `docs_old/` deleted. New artefacts: `docs/contributing/` (9 handwritten internal docs + `architecture-history/` with 25 historical SWF v0 files); `docspec/` populated with concepts (12), references (commands × 9, agents × 15, designers × 2, indexers × 1, plus 7 cross-cutting refs), how-tos (6), tutorials (2), personas (2), tasks (4), assets (6 screenshots). See [`docs-migration.md`](safe-ai-factory/saifctl/features/release-readiness/docs-migration.md) for the per-file audit. Schema-fit observation: agents/designers/indexers reused `cli-command` reference type since saifdocs schema doesn't have dedicated types yet — acceptable for v0.1; tracked as [safe-ai-factory/saifdocs#1](https://github.com/safe-ai-factory/saifdocs/issues/1) (recommendation: open the `type:` field to any string, retire the closed enum).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `docspec/`, `docs/contributing/`, `docs_old/` (deleted)                                                                                                                                                                                                                                                                   |
| DOC-09.3 | B   | ✅     | **Gap audit complete (2026-05-05).** Source-side surfaces compared against docspec entries. Confirmed coverage: 9 commands (incl. `feat-phases`, the previously-undocumented one), 15 agents, 2 designers, 1 indexer, 13 concepts (including the gauntlet, lifecycle, security, leash, infra, services, hatchet, source-control, sandbox, features), 7 cross-cutting refs (`config`, `docker-images`, `env-vars`, `agent-environment`, `models`, `sandbox-profiles`, `test-profiles`), plus a new `references/storage.md` for run-storage backends added in this step. **DOC-08 authored** as `docspec/products/saifctl/tutorials/spec-driven-development.md` (resolves DOC-08 ✅). Final docspec count via `saifdocs gen --dry-run`: 59 manifest entries (35 references, 13 concepts, 7 how-tos, 3 tutorials, 1 landing page). DOC-07 (FAQ/SUPPORT/ROADMAP) is the remaining open documentation item — N severity, ⚠️, intentionally deferred per its row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `docspec/` (complete for v0.1)                                                                                                                                                                                                                                                                                            |
| DOC-09.4 | B   | ✅     | **Generate.** `saifdocs gen --project-dir .` → `saifctl feat run --feature saifdocs-<ts>` → `saifdocs audit` + `saifdocs validate`. Inspect output. Hand-fix any pages where the agent output is wrong (this is exactly why we keep `docs/` git-tracked). **Resolved 2026-05-08:** saifctl-side run produced 24 pages under `docs/products/saifctl/` (concepts × 13, how-tos × 7, tutorials × 3, plus landing); saifdocs-side run (today, against `vendor/saifdocs/docspec/`) produced 13 pages + landing under `vendor/saifdocs/docs/products/saifdocs/`. Both manifests' `generatedAt` fields are still null — that's a stale-manifest artifact from later `saifdocs gen --dry-run` rebuilds, not evidence of missing runs (the output trees are present and substantive). Both feed `web/scripts/sync-docs.ts` cleanly; `web/src/content/docs/{saifctl,saifdocs}/` populated end-to-end (closes WEB-01). **Post-DOC-09.5 staleness check shipped 2026-05-09:** [tests-docs.yml](safe-ai-factory/.github/workflows/tests-docs.yml) now runs `saifdocs validate` after the existing `gen --dry-run` schema step. Three preconditions landed in sequence: (1) **`generatedAt` write-back** in [`@safe-ai-factory/saifdocs@0.3.2`](https://www.npmjs.com/package/@safe-ai-factory/saifdocs/v/0.3.2) so the field stops being null after a gen run. (2) **Pre-existing saifctl docspec schema bugs fixed** — `analogies` list had unquoted `: ` ([per-phase-config.md](safe-ai-factory/docspec/products/saifctl/concepts/per-phase-config.md)) and two how-tos used template-shape `intent:` instead of `persona/tasks/goal` ([configure-a-phase.md](safe-ai-factory/docspec/products/saifctl/how-tos/configure-a-phase.md), [pure-output-phase.md](safe-ai-factory/docspec/products/saifctl/how-tos/pure-output-phase.md)). (3) **Content-hash staleness** in [`@safe-ai-factory/saifdocs@0.4.0`](https://www.npmjs.com/package/@safe-ai-factory/saifdocs/v/0.4.0) — replaced fs-mtime comparison with SHA-256 over file bytes. Mtime-based checks were unreliable across any transport that resets timestamps (fresh git checkouts, `cp`/`rsync` without `-t`, `tar` without `-p`); content hashes are filesystem-independent. ManifestEntry now carries `outputHash` + `inputHashes` (parallel to `read[]`), populated from disk by `populateHashesFromFiles` (renamed from `populateGeneratedAtFromOutputs`). The CI workflow no longer needs `git-restore-mtime`. The previous "manifest is committed and current" `git diff --exit-code` step was dropped — it had been silently failing on every CI run since `createdAt` always refreshes. Restoring that check would require a saifdocs `--check` mode that compares manifests structurally (modulo volatile fields); tracked separately if it becomes useful. | `docs/` (populated), `vendor/saifdocs/docs/` (populated), `web/src/content/docs/` (synced)                                                                                                                                                                                                                              |
| DOC-09.5 | I   | ✅     | **CI + `docs/README.md` shipped (2026-05-05; staleness-check follow-up shipped 2026-05-09).** Workflow [`.github/workflows/tests-docs.yml`](safe-ai-factory/.github/workflows/tests-docs.yml) runs `saifdocs gen --project-dir . --dry-run` on PRs touching `docspec/`, `docs/`, or any `source:`-referenced file (`src/cli/commands/`, `src/agent-profiles/`, `src/designer-profiles/`, `src/indexer-profiles/`, `src/{sandbox,test}-profiles/`, `src/config/`, `src/storage/`, `src/orchestrator/agent-env.ts`, `src/llm-config.ts`, `src/constants.ts`, `scripts/docker.ts`, `vendor/saifdocs`). Catches frontmatter errors, schema-enum violations, YAML parse failures, and stale `source:` paths. The original "manifest is committed and current" `git diff --exit-code` check was dropped — it silently failed every run because `createdAt` (and now content hashes) always refresh on each gen. **Staleness gate added 2026-05-09:** the workflow now also runs `saifdocs validate --docspec-dir docspec`, which fires on the next push if any `read` path's content hash differs from the recorded one — the post-DOC-09.4 TODO that originally targeted "mtime-only" went further and uses content hashes (filesystem-independent; works on fresh CI checkouts, file copies, tar extracts) per [`@safe-ai-factory/saifdocs@0.4.0`](https://www.npmjs.com/package/@safe-ai-factory/saifdocs/v/0.4.0). New [`docs/README.md`](safe-ai-factory/docs/README.md) introduces the dual-tree (generated + `contributing/`) and shows the post-refactor `saifdocs gen --project-dir .` invocation. **Top-level README sweep was moved out of this row into DOC-01** — turned out to be a broader rewrite (not just link replacement), so it belongs with the rest of the README work. | `docs/README.md` ✅, `.github/workflows/tests-docs.yml` ✅                                                                                                                                                                                                                                                              |
| DOC-09.6 | I   | ✅     | **`architecture-history/` restructured into `architecture/` (2026-05-06).** Follow-on to DOC-09.2: the 25 SWF v0 files were initially bulk-moved without content review and contained outdated framing (OpenSpec gone; OpenHands as "the engine"; Shotgun as "the designer"). Restructured into `docs/contributing/architecture/` — 11 focused docs by current concept, each with file:line anchors into `src/`: `orchestrator.md`, `sandbox-isolation.md`, `cedar-and-leash.md`, `gate-and-reviewer.md`, `test-runner.md`, `spec-pipeline.md`, `extension-points.md`, `git-and-patches.md`, `services-and-iac.md`, `installation-scripts.md`, `security-threats.md` (+ `README.md` index). Each authored from current-source review, not 1:1 port. Folds into existing `docs/contributing/`: `docker.md`, `hatchet.md`, `adding-agents.md` enriched with cross-links + missing material (drop-privileges contract, Hatchet phased status). Cross-references in `src/`, `docspec/`, example features updated. `architecture-history/` deleted; content recoverable from git. New memory rule [`feedback_internal_doc_style.md`](feedback_internal_doc_style.md) saved (concrete-first, no meta-narration; sister rule to user-facing copy style). Per-file audit: [`architecture-history-review.md`](safe-ai-factory/saifctl/features/release-readiness/architecture-history-review.md).                                                           | `docs/contributing/architecture/`, `docs/contributing/{docker,hatchet,adding-agents,inner-round-stats,README}.md`, `src/config/schema.ts:9`, `src/orchestrator/policies/default.cedar:55-65`, `docspec/products/saifctl/concepts/features.md`, `saifctl/features/_phases-and-critics/phases/09-docs-and-examples/spec.md` |

</details>

**Locked decisions (see [`docs-migration.md`](safe-ai-factory/saifctl/features/release-readiness/docs-migration.md) for the per-file working tracker):**

- `docs/` is **git-tracked** (both saifctl and saifdocs). Generated, but committed. Enables incremental regen + manual fixes when LLM output drifts.
- `docs/` follows saifdocs' folder layout exactly. No `manual/`/`generated/` split. Where a page can't fit the schema, prefer adding a saifdocs feature (escape hatch) over per-repo workaround.
- Saifdocs schema fit is unproven at saifctl's scale — this is its first live test. Default: try the schema; only when something genuinely doesn't fit do we discuss extending saifdocs.
- `docs_old/development/v0/` survives as cleaned-up internal docs under a `contributing/architecture-history/` subtree. Per-file decision: drop / rewrite / keep as-is.
- DOC-08 destination is `docspec/` — concept vs. tutorial vs. split is decided when authoring.
- Same applies to every other "write a doc" item in the spec (DOC-04, DOC-05, DCK-01 et al). Their content currently in `docs_old/` rides DOC-09.2 to its docspec destination.
- NPM-18 audit owner: user. Audit evidence: the per-file tracker.
- **Schema-fit findings (from `vendor/saifdocs/` source review, 2026-05-05):**
  1. **Reference pages**: `source:` is one path string resolved against `projectDir`; gets appended to the manifest entry's `read` list. Single file per `source:`. Per-top-level-command granularity (one stub per `src/cli/commands/<top>.ts`, subcommands as sections in the generated page) works because saifctl's command files keep all subcommands inline.
  2. **Assets**: no first-class support. Convention: place images under `docspec/assets/` + instruct the agent in the docspec body to embed `![alt](...)` references. Path math will need attention.
  3. **`docs/contributing/` co-location is risky**: `saifdocs clear` runs `rm -rf $outputDir` without consulting the manifest. **Decision needed before DOC-09.2 starts** (see open decisions below).

**Resolved 2026-05-05:**

- **`docs/contributing/` location**: place at `safe-ai-factory/docs/contributing/` (co-located with generated tree). Gated on **SDR-10** — patch `saifdocs clear` to only delete files the manifest claims to own. Done up front before DOC-09.2 starts.
- **Assets**: stay with `docspec/assets/` + body-instruction approach. First-class asset support filed as **SDR-11** follow-up; deferred past v0.1.

Touches: DOC-01, DOC-02, DOC-04, DOC-05, DOC-08, DCK-01, NPM-18, **SDR-10** (new — gates DOC-09.2), **SDR-11** (new — deferred).

### 3.5 Docker / sandbox

<details>
<summary>Show 5 work items</summary>

| ID     | Sev | Status | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Citation                                                                                              |
| ------ | --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| DCK-01 | I   | ✅     | `scripts/docker.ts` originally built images locally with no release-time push and no image inventory page. **Resolved 2026-05-04 (per Decision D-19):** (1) the existing `publish-images.yml` workflow had a stale `pnpm docker build stage --all` step (leftover from when stage and coder were separate envs, pre-merge) — the script never had a `stage` subcommand, so the workflow had never produced a release. Stale step deleted. (2) `scripts/docker.ts` extended with `--push`, `--platforms`, `--image-prefix`, `--extra-tag` flags that switch to `docker buildx build --push` and verify each pushed manifest with `docker buildx imagetools inspect`. (3) Workflow trigger collapsed from `release: published` + `push: tags: 'v*'` (which double-fired) to `release: published` + `workflow_dispatch` for manual republish; checkout pinned to the resolved tag. (4) Multi-arch added: `linux/amd64,linux/arm64` via `setup-qemu-action` + `setup-buildx-action`. (5) Two end-of-job functional smoke tests added: `docker run` against the default coder and test images executing `node --version` (and `pnpm --version` for coder). (6) New inventory page [`docs_old/docker-images.md`](safe-ai-factory/docs_old/docker-images.md) documents the registry path (`ghcr.io/safe-ai-factory/saifctl/<image>`), tag conventions, full image list per profile family, pre-pull commands, and the override flags for custom images. README's Reference section links to it. **Note on location:** content lives in `docs_old/` because `docs/` is auto-generated by saifdocs and the saifdocs migration is in flight; eventual transplant to `vendor/saifdocs/docspec/` tracked under NPM-18. | `scripts/docker.ts`, `.github/workflows/publish-images.yml`, `docs_old/docker-images.md`, `README.md` |
| DCK-02 | I   | ✅     | Default Cedar policy `permits all outbound network` ([default.cedar:80-86](safe-ai-factory/src/orchestrator/policies/default.cedar)). **Decision D-06** locked in the unrestricted default. **Resolved 2026-05-04:** wrote [`docs_old/security.md`](safe-ai-factory/docs_old/security.md) (replacing the prior marketing-overclaim version) covering (1) what saifctl protects against (host fs, agent process integrity via `/workspace/saifctl/` write-deny, host secrets, host-hook escape via `.git`); (2) what it doesn't (network exfil, kernel exploits, agent CLI supply chain, malicious LLM-induced typosquats); (3) filesystem-as-boundary rationale for the unrestricted-network default; (4) `--cedar` override surface listing all three bundled policies (`default`, `sandbox`, `deny-network`); (5) the `dangerousNoLeash` mode (covers DCK-04). Cross-links to the existing `docs_old/leash-access-control.md` (DOC-05). Lives in `docs_old/` pending saifdocs migration (NPM-18).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `src/orchestrator/policies/default.cedar:80-86`, `docs_old/security.md`                               |
| DCK-03 | I   | ✅     | `saifctl doctor` was originally shallow: Docker daemon, Leash binary, Hatchet token only. **Resolved 2026-05-04** in stages: (a) Hatchet check made three-state (no token / token-without-flag / token-with-flag) per D-04 (NPM-03 follow-up); (b) Argus reviewer release-endpoint HEAD probe added (VND-01 / CLM-01 follow-up); (c) **2026-05-04 deepening:** four new checks landed in [src/cli/commands/doctor.ts](safe-ai-factory/src/cli/commands/doctor.ts) — (i) **Leash daemon image presence:** `docker image inspect $DEFAULT_LEASH_IMAGE`, falling back to `docker buildx imagetools inspect` registry probe if absent locally; warns if neither. (ii) **Default coder + test image presence:** same shape for `DEFAULT_SANDBOX_PROFILE.coderImageTag` and `saifctl-test-${DEFAULT_TEST_PROFILE.id}:latest`. (iii) **Cedar policy structural lint:** for `default.cedar`, checks file exists, is non-empty, and contains at least one `permit`/`forbid` rule. **Note:** real Cedar parse validation deferred to v1.0 — Leash CLI has no validator subcommand (verified `leash --help`), and `@cedar-policy/cedar-wasm` is ~12 MB unpacked, too heavy to bundle just for doctor; the Leash daemon itself parses Cedar at runtime and fails fast on syntax errors there. (iv) **LLM provider key presence:** iterates `PROVIDERS` table from `src/llm-config.ts` (now exported); warns if no provider env var is set. **Liveness probe (actual API call) deferred to v1.0** — per-provider edge cases (Vertex token mint, OpenRouter compat, Ollama URL detection) and billing-surprise risk push real liveness past v0.1. Doctor command now runs 8 checks total.                                | `src/cli/commands/doctor.ts`, `src/llm-config.ts`                                                     |
| DCK-04 | I   | ✅     | The `dangerousNoLeash` mode disables Cedar enforcement entirely. **Resolved 2026-05-04** as part of the DCK-02 / DOC-04 doc sweep: a dedicated section in [`docs_old/security.md`](safe-ai-factory/docs_old/security.md#the-dangerousnoleash-mode) explains what it does (Leash bypassed, Cedar rules are no-ops, host-hook `.git` escape path open, reward-hacking guardrail removed, filesystem boundary still holds), when it's appropriate (orchestrator debugging, narrowing a Cedar policy, perf profiling), and when it isn't (anything with secrets, CI, unattended runs, runs whose diff will be committed without careful review). The `docs_old/leash-access-control.md` page also links here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `src/engines/docker/index.ts`, `docs_old/security.md#the-dangerousnoleash-mode`                       |
| DCK-05 | I   | ✅     | **Publish-workflow trigger consistency.** `publish-npm.yml` originally fired on `push: tags: 'v*'`, which (a) couldn't be triggered without an actual tag push and (b) drifted from `publish-images.yml` after Decision D-19. **Resolved 2026-05-04:** trigger collapsed to `release: published` + `workflow_dispatch` (with required `tag` input) for manual republish; checkout pinned to the resolved tag. Now consistent with the image workflow — a single `gh release create vX.Y.Z` event publishes both npm and images. `publish-extension.yml` keeps `push: tags: 'ext-v*'` because it tracks an independent SemVer train per Decision D-02.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `.github/workflows/publish-npm.yml`                                                                   |

</details>

### 3.6 Marketing-vs-reality (README)

These are claims the README makes that the code does not back literally,
or that need clarification before launch.

<details open>
<summary>Show 8 work items</summary>

| ID     | Sev | Status | Claim → Reality                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Suggested resolution                                                                                                                                                                                                                                             |
| ------ | --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLM-01 | B   | ✅     | "Adversarial AI that scrutinizes the diff" → reviewer.sh wraps an external `argus` binary that is auto-downloaded at runtime via `ensureArgusBinary()` (`src/orchestrator/sidecars/reviewer/argus.ts:33-46,88`). **Resolved as part of VND-01 / D-14 + Q-03 / D-15:** (1) README Requirements line discloses the network-fetch dependency and points users at `--no-reviewer` for offline runs; (2) `saifctl doctor` HEAD-probes the argus release endpoint and surfaces a clear failure if unreachable; (3) source-of-truth for binaries is `safe-ai-factory/argus` releases at `argus-core-v${ARGUS_VERSION}` (will switch to upstream `Meru143/argus` once PR #75 merges + ships, see VND-06); (4) **Q-03 closed via D-15** — path (e) (runtime download + mount) is the chosen strategy, locked in. The original audit's "silently passes if absent" framing was inverted — the system actively ensures presence.                                                                            | `README.md`, `src/cli/commands/doctor.ts`, `src/orchestrator/sidecars/reviewer/argus.ts`                                                                                                                                                                         |
| CLM-02 | I   | ✅     | "Locked in a loop and physically cannot stop until tests pass" → bounded by `maxRuns` (default 5) and `testRetries`. **Resolved:** README line 30 reworded to "The agent runs a bounded convergence loop; code that fails your new TDD tests doesn't ship." Honest about the bound, preserves the spirit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `README.md:30`                                                                                                                                                                                                                                                   |
| CLM-03 | I   | ⚠️     | "14 Agentic CLI tools" → 15 profiles exist (one is `debug`), only 3 have any tests (debug, cursor, openhands).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Either trim "supported" list to the tested ones, or add a "supported (best-effort)" tier with smoke-test status.                                                                                                                                                 |
| CLM-04 | I   | 👍     | "All major LLM providers" / "19 providers" messaging in README, web, and docs is no longer literally accurate after **Decision D-05** (we now ship 4 native SDKs + OpenAI-compatible routing for everything else).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Replace with "OpenAI-compatible API + native Anthropic, Google (Generative AI), and Google Vertex support". Sweep README, `web/src/app/saifctl/page.tsx`, `web/src/app/constants.ts`, and any docs surface. Smoke tests scoped to the 4 native paths (see X-04). |
| CLM-05 | I   | 👍     | "zero-trust, sandboxed Docker environment" → filesystem isolated, network unrestricted by default. **Decision D-06.** Reword the marketing line (drop "zero-trust" or qualify with "filesystem-isolated") and link to `docs/security.md` for the full threat model. Shares execution scope with DCK-02, DOC-04, DOC-05.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CLM-06 | I   | 🟠     | "Spec-driven AI factory" / various marketing — uses several capitalised terms (Gauntlet, Gate, Reviewer, Holdout, Critic, Reviewer-gate) that overlap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Lock the vocabulary in a one-page glossary; the `_phases-and-critics/plan.md` already pins some of these.                                                                                                                                                        |
| CLM-07 | I   | ✅     | README mentions Hatchet/distributed-runs adjacently; reality is gated to local mode for v0.1. **Decision D-04.** **Resolved as no-op for the README surface:** verified during NPM-03 implementation that `README.md` has **zero** Hatchet references — no rewrite needed. The web saifctl page mentions Hatchet only inside an HTML comment TODO marked "out of scope for alpha" (line 151), which never renders to users. The code-side gating (NPM-03) is what closes this row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `README.md`, `web/src/app/saifctl/page.tsx:151`                                                                                                                                                                                                                  |
| CLM-08 | I   | ✅     | **Sweep secondary marketing surfaces for "physically X" / "mechanically impossible" overclaims** (CLM-02 only covered one specific README line; the same pattern recurs elsewhere). **Resolved:** sweep performed and live surfaces fixed in tier-1 follow-up: README.md:33 ("Regressions are mechanically impossible" → "mechanically prevented — code that breaks them can't ship"); web/src/app/saifctl/page.tsx:1131 (same fix as CLM-02); web/src/app/saifctl/page.tsx:1136 ("Regressions are impossible" → "mechanically prevented"); web/src/app/saifctl/page.tsx:1427 ("Docker network is physically isolated" → qualified "with a Cedar deny-network policy in place"); web/plan.md:42-43 ("physically cannot cheat" + "outbound calls are blackholed" → tightened to honest Cedar-policy framing). Stale surfaces deferred: docs_old/_ (handled by NPM-18 transplant), web/x_design/_ (handled by PRE-07 human cleanup), vscode-ext/README_v2.md (handled by VSX-01 editorial choice). | `README.md`, `web/src/app/saifctl/page.tsx`, `web/plan.md`                                                                                                                                                                                                       |

</details>

### 3.7 Vendor / upstream dependencies (`vendor/`)

`VND-` prefix introduced by **Decision D-12** to break NPM-19's umbrella
row into per-subdir items. Each row covers one entry under `vendor/`.
Current state confirmed by investigation (see Appendix A):

<details open>
<summary>Show 6 work items</summary>

| ID     | Sev | Status | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Citation                                                                                                                                    |
| ------ | --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| VND-01 | B   | ✅     | **`vendor/argus`** — fork of `Meru143/argus`. **Decision D-14 (Q-15 → path d).** Resolved end-to-end on 2026-05-04. Concrete outcomes: (1) **Org transfer** `JuroOravec/argus` → `safe-ai-factory/argus`; (2) **saifctl-side URL refresh** — `.gitmodules`, `src/orchestrator/sidecars/reviewer/argus.ts:34` `REPO`, header comment, `vendor/README.md`; (3) **Fork `release.yml` aligned with upstream's intended end-state** — switched trigger to `argus-core-v*`, restored `softprops/action-gh-release@v2`, dropped fork-only optimizations (LTO/strip env, rust-cache, defensive packaging); (4) **New fork release** at <https://github.com/safe-ai-factory/argus/releases/tag/argus-core-v0.5.6> with all 7 platform archives (5 + 2 musl), workflow run <https://github.com/safe-ai-factory/argus/actions/runs/25318823946>; (5) **saifctl URL pattern** — `argus.ts` downloads from `argus-core-v${ARGUS_VERSION}` in both `ensureArgusBinary` (~line 87) and `probeArgusReleaseEndpoint` (~line 156); (6) **`saifctl doctor` HEAD-probe** of the argus release endpoint added (DCK-03 follow-up); (7) **README Requirements line** discloses the network-fetch dependency (CLM-01 follow-up); (8) **Upstream PR submitted** — [Meru143/argus#75](https://github.com/Meru143/argus/pull/75) with 3 commits (release-plz GH_PAT fix to bypass GitHub Actions' anti-recursion rule, `argus-core-v*` trigger, musl additions). Once that merges _and_ upstream cuts a tagged release that ships binaries, VND-06 fires. Investigation history (preserved for future debugging): two-stage re-check found that the original audit's "argus silently passes if absent" was inverted — the binary IS auto-downloaded; and the actual upstream bug is the `GITHUB_TOKEN` anti-recursion issue, not the trigger pattern alone (binary releases haven't worked since v0.2.2, not v0.5.3 as initially claimed). | `vendor/argus`, `.gitmodules`, `src/orchestrator/sidecars/reviewer/argus.ts`, `src/cli/commands/doctor.ts`, `vendor/README.md`, `README.md` |
| VND-02 | I   | ✅     | **`vendor/leash`** — fork of `strongdm/leash`. **Decision D-16 (2026-05-04).** Re-investigation confirmed upstream PR [strongdm/leash#71](https://github.com/strongdm/leash/pull/71) MERGED to upstream main (commit `164015b`, 2026-04-06) but **no upstream artifact yet ships the fix** — latest npm `@strongdm/leash@1.1.7` (2026-03-11), latest tag `v1.1.7` (2026-03-04), and `public.ecr.aws/s5i7k8t3/strongdm/leash:v1.1.7`/`:latest` images all predate the fix landing. 28+ days since the commit landed without a tagged upstream release. So we still need the patched image. **Resolved end-to-end:** (1) **Org transfer** `JuroOravec/leash` → `safe-ai-factory/leash` (PRE-09 expanded scope); (2) **Multi-arch Docker image rebuilt + pushed** to `ghcr.io/safe-ai-factory/leash:latest-h2patch` + `ghcr.io/safe-ai-factory/leash:h2patch-e5ed6b5` (linux/amd64 + linux/arm64; layers cached from prior build, push completed in seconds); (3) **saifctl-side** — `.gitmodules` URL, `git submodule sync`, `DEFAULT_LEASH_IMAGE` in `src/constants.ts:131` flipped to new GHCR namespace + comment block updated, `vendor/README.md` swept; (4) **Verified** new image pulls cleanly + 759 saifctl tests pass. **No upstream PR** — the substantive fix is already merged; bottleneck is the maintainer cutting a tagged release. Optional later: open an issue politely asking for v1.1.8 (skipped for now — low impact, low effort either way). **Phase-4 deletion (➡️ deferred):** when upstream cuts a tag containing `164015b`, follow the removal plan — drop `DEFAULT_LEASH_IMAGE`, remove `WORKAROUND(leash-http2)` block in `src/engines/docker/index.ts`, deinit submodule, bump `@strongdm/leash` in `package.json`.                                                                                                                                                                 | `vendor/leash`, `.gitmodules`, `src/constants.ts:131`, `vendor/README.md`, `package.json` (`@strongdm/leash`)                               |
| VND-03 | I   | ✅     | **`vendor/saifbox`** — folded into saifctl end-to-end (2026-05-07). Investigation found saifbox is literally `saifctl sandbox` (the existing CLI subcommand): every saifbox doc tutorial decodes to `saifctl sandbox --agent <name>`. saifbox was a marketing wrapper around the existing capability. **Resolved per Decision D-20:** docspec content merged into `docspec/products/saifctl/` (concept + tutorial + how-to + `claude_user` persona — renamed from the original `openclaw_user` after side-investigation found OpenClaw is itself an orchestrator that delegates to claude/codex/opencode and is not a saifctl agent profile, see `saifctl/features/openclaw-agent-profile/design.md`); saifctl `product.md` rewritten to two-modes framing; the redundant `how-tos/run-agent-safely` was deleted (tutorial covers the ground); `vendor/saifbox/` deleted; `web/src/app/saifbox/` deleted (no redirects per "pretend saifbox never existed"); `web/src/content/docs/saifbox/` auto-cleaned by sync-docs once the source disappeared; saifbox SOURCES + filterEntriesForProduct + absPathToWebUrl branches stripped from `web/scripts/sync-docs.ts`; `saifbox` dropped from `DOC_PRODUCTS`; Nav, Footer, Home (3→2 product cards with rewritten saifctl description), and home tagline metadata all updated. Stray refs in saifdocs upstream (test fixture + design.md) cleaned and pushed to `safe-ai-factory/saifdocs`. `npm run build` passes; `rg saifbox` repo-wide returns only the spec's intentional historical record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `vendor/saifbox/`, `web/scripts/sync-docs.ts`, `web/src/app/saifbox/`, `web/src/content/docs/saifbox/`                                      |
| VND-04 | I   | ✅     | **`vendor/saifdocs`** — architectural decoupling + publish-readiness **complete 2026-05-04**. Saifdocs was refactored from an _orchestrator_ (which spawned `saifctl sandbox` per-page) into a _compiler_ that emits a saifctl feature tree (one phase per file-to-generate, plus an `audit` critic). Saifdocs's runtime dependency on saifctl is gone (now devDep only); the user runs `saifctl feat run --feature saifdocs-<timestamp>` after each `saifdocs gen` to actually drive generation. **Decisions D-17** (Q-13 resolution: yes refactor; refactor done) and **D-18** (Q-12 resolution: independent publish timing). Saifdocs ships **no Cedar policy** (per Q-13's clarification — consumer repo decides). 153/153 tests passing in saifdocs; lint/typecheck/build clean. **All §3.8 SDR-01..SDR-09 closed** (SDR-08 / SDR-09: org repo migration + submodule registration; PRE-11: first publish + npm Trusted Publishing OIDC). **SDR-10** (`clear` only deletes manifest-tracked files) and **SDR-11** (first-class asset support) added 2026-05-05 as DOC-09 follow-ups; SDR-10 gates DOC-09.2, SDR-11 is deferred past v0.1. `@safe-ai-factory/saifdocs@0.1.0` live on npm, smoke-tested via `npx -y @safe-ai-factory/saifdocs --help`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `vendor/saifdocs/`, `vendor/saifdocs/src/features/compiler.ts`, `web/scripts/sync-docs.ts`                                                  |
| VND-05 | N   | ✅     | **`vendor/dev-containers-manifests`** — flat folder of MS vs Cursor remote-containers manifest research informing `vscode-ext/src/inspectAttach.ts`. **Resolved per Decision D-13** (option (b) of Q-14): content folded + adjusted into a single doc at `vscode-ext/docs/cursor-vs-vscode-remote-containers.md`. Lifted COMPARISON.md analysis + README.md reproduction instructions; added "Last verified" header (2026-04-01 / MS 0.452.0 / Cursor 1.0.32), §5 "When to revisit" trigger list, §6 explaining the missing JSON dumps. Dropped the four raw JSON dumps (~147 KB) as regeneratable per §4 of the new doc. `inspectAttach.ts` inline comments slimmed and now cross-link to the new doc. `vendor/dev-containers-manifests/` deleted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `vscode-ext/docs/cursor-vs-vscode-remote-containers.md`, `vscode-ext/src/inspectAttach.ts`                                                  |
| VND-06 | I   | ➡️     | **Phase 4 — migrate saifctl back to consume upstream `Meru143/argus`.** Scope **narrowed** since VND-01 done: tag-pattern change (`argus-core-v*`) already in place on saifctl side, so only the `REPO` swap + submodule cleanup remain. Deferred until _both_ (1) upstream PR [Meru143/argus#75](https://github.com/Meru143/argus/pull/75) merges, and (2) upstream cuts a tagged release that actually contains binaries (i.e. the workflow on `Meru143/argus` fires on a real `argus-core-vX.Y.Z` and produces a Release with the 7 archives, including the 2 musl ones). Watch trigger: monitor <https://github.com/Meru143/argus/releases> for any post-merge tag whose Release page lists asset binaries (not source-only). Once both gates pass: **(a) Code change** — one line in `src/orchestrator/sidecars/reviewer/argus.ts:34`: <pre>const REPO = 'safe-ai-factory/argus'; → 'Meru143/argus';</pre> Also bump `ARGUS_VERSION` to a post-merge upstream version that has binaries on its Release page. (Tag template is already `argus-core-v${ARGUS_VERSION}` per VND-01 work — no change needed there.) **(b) Submodule cleanup** — `git submodule deinit vendor/argus`, `git rm vendor/argus`, remove the `[submodule "vendor/argus"]` block from `.gitmodules`, delete the argus section of `vendor/README.md`. **(c) Fork archival** — optionally archive `safe-ai-factory/argus` on GitHub (Settings → Archive) as a backup mirror or leave active for emergency rollback; either is fine. **(d) Verify** — `rm -rf /tmp/saifctl/bin/argus-*` then run `saifctl doctor` (the probe in DCK-03 is already wired) — should report the upstream URL reachable; then trigger a real reviewer run to confirm download + extract + execute.                                                                                                                                                           | `src/orchestrator/sidecars/reviewer/argus.ts:34`, `.gitmodules`, `vendor/README.md`, `vendor/argus/`                                        |

</details>

### 3.8 Saifdocs publish readiness (`SDR-`)

`SDR-` (Saifdocs Release) prefix introduced after the **D-14 / D-15**
saifdocs refactor shipped (2026-05-04). Tracks the remaining work to
make saifdocs a _publishable_ standalone npm package — separate from
the architectural decoupling, which is done. All items live in
`vendor/saifdocs/` (or in the parent saifctl repo where noted) and
all assume the refactor at VND-04 has landed.

<details>
<summary>Show 9 work items</summary>

| ID     | Sev | Status | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Citation                                                                                                                             |
| ------ | --- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| SDR-01 | B   | ✅     | **Version bumped `0.0.1` → `0.1.0`** in `package.json`; CHANGELOG `[Unreleased]` block promoted to dated `[0.1.0] — 2026-05-04` entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `vendor/saifdocs/package.json:3`, `vendor/saifdocs/CHANGELOG.md`                                                                     |
| SDR-02 | B   | ✅     | **`engines.node`** in `package.json` bumped from `>=20` to `>=22.0.0`. CI workflows already used Node 22.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `vendor/saifdocs/package.json:35-37`                                                                                                 |
| SDR-03 | I   | ✅     | **Unified publish flow + npm Trusted Publishing (OIDC).** Added `vendor/saifdocs/scripts/package.sh` (mirrors saifctl's). Updated `publish-npm.yml`: runs `bash scripts/package.sh` (build + `npm pack` into `dist-pack/`) and then `npm publish ./dist-pack/safe-ai-factory-saifdocs-*.tgz --access public --provenance` (note the `./` — without it npm misparses the bare path as a GitHub `<owner>/<repo>` shortcut) — what verifies locally is bit-identical to what ships, plus provenance attestation. Dropped `prepublishOnly` from `package.json`; added `package:build` script. **Authentication via OIDC (no NPM_TOKEN secret stored)** — workflow has `permissions: id-token: write`, header comment documents the bootstrap (manual first publish + Trusted Publisher config; tracked as PRE-11). Verified: produces `safe-ai-factory-saifdocs-0.1.0.tgz` (133 KB). | `vendor/saifdocs/scripts/package.sh` (new), `vendor/saifdocs/.github/workflows/publish-npm.yml`, `vendor/saifdocs/package.json`      |
| SDR-04 | N   | ✅     | **Defensive `.npmignore` added** at `vendor/saifdocs/.npmignore` (excludes tests, dev tooling, build outputs, generated docs, OS junk, scripts, docspec). Belt-and-suspenders alongside the `files` allowlist. Also added `dist-pack/` and `*.tgz` to `vendor/saifdocs/.gitignore`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `vendor/saifdocs/.npmignore` (new), `vendor/saifdocs/.gitignore`                                                                     |
| SDR-05 | B   | ✅     | **3 knip-blocking unused exports fixed** (resolution: drop `export` keyword, not suppress per user direction). `readHowTosDir`, `readTutorialsDir` (both used internally in `src/docspec/reader.ts`) and `TaskUserStageSchema` (used internally in `src/docspec/schema.ts`) are now scoped local. CI `pnpm run check` is now clean. Bonus: while sweeping, also deleted dead exports `extractIncludePrefix`, `sandboxNameFromEntryId`, `MAX_SANDBOX_NAME_LEN` from `src/generation/output-paths.ts` (only referenced by their own test file post-refactor; the test cases were dropped too).                                                                                                                                                                                                                                                                                     | `vendor/saifdocs/src/docspec/reader.ts`, `vendor/saifdocs/src/docspec/schema.ts`, `vendor/saifdocs/src/generation/output-paths.ts`   |
| SDR-06 | B   | ✅     | **Saifdocs docspec swept for outdated saifctl-spawning references.** Updated `docspec/products/saifdocs/product.md` (now describes the compiler model), `docspec/products/saifdocs/concepts/generation-pipeline.md` (now explains feature-tree-emit → `saifctl feat run`), `docspec/reference/commands/saifdocs/gen.md` (drops `--gate-retries`, mentions `--saifctl-features-dir`/`--feature-id`), `docspec/reference/commands/saifdocs/review.md` (drops `--strict-network`/`--cedar`, notes "no saifdocs-shipped Cedar"). Verified no remaining `saifctl sandbox` / `--gate-retries` / `--strict-network` / `review*.cedar` refs in docspec or src (except intentional "saifdocs no longer spawns" historical comments). 149/149 tests passing post-sweep.                                                                                                                    | listed in resolved row                                                                                                               |
| SDR-07 | I   | ✅     | **`docs_old/` deleted (no transplant needed).** Audit confirmed every `docs_old/` file (4 concepts, 4 tutorials, 1 how-to) had a matching docspec intent file already capturing the same concept (`manifest-build-plan`, `staleness-tracking`, `docspec`, `generation-pipeline`, the four tutorials, `generate-first-docs`). When saifdocs runs against the current docspec, the new `docs/` will cover the same conceptual ground. Bonus: also deleted the stale generated `docs/` dir (was accidentally committed earlier; gitignored now).                                                                                                                                                                                                                                                                                                                                    | `vendor/saifdocs/docs_old/` (deleted), `vendor/saifdocs/docs/` (deleted)                                                             |
| SDR-08 | B   | ✅     | **Saifdocs pushed to `github.com/safe-ai-factory/saifdocs` (2026-05-04).** PRE-10 was completed by the user (org repo created with auto-generated LICENSE-only initial commit). Set local `origin` to `git@github.com:safe-ai-factory/saifdocs.git`, updated local `LICENSE` copyright `JuroOravec` → `Safe AI Factory` to match the org-correct form, committed all refactor changes as `f776842 refactor: saifdocs is now a saifctl-features compiler (no runtime saifctl dep)` (73 files changed, +4189/-2606), force-pushed (auto-generated GitHub initial-commit replaced; local already preserved the LICENSE content). Final remote history: `f080642 → 5cd3d88 → 6c0ec1c → f776842`. Parent saifctl repo HEAD unchanged.                                                                                                                                                 | `vendor/saifdocs/.git/`, [github.com/safe-ai-factory/saifdocs](https://github.com/safe-ai-factory/saifdocs)                          |
| SDR-09 | B   | ✅     | **`vendor/saifdocs/` is now a registered git submodule** in the parent saifctl repo. Pointed at `git@github.com:safe-ai-factory/saifdocs.git`. Sequence executed: removed local nested-`.git` dir from disk → `git submodule add ... vendor/saifdocs` (clean re-clone from origin). The change is **staged but uncommitted** in the parent saifctl repo (per user directive: don't push the parent) — `.gitmodules` has the new `[submodule "vendor/saifdocs"]` block, and the submodule gitlink is staged. User commits + pushes the parent repo when convenient. Resolves the saifdocs half of PRE-08.                                                                                                                                                                                                                                                                         | `.gitmodules` (staged), `vendor/saifdocs/` (now a submodule)                                                                         |
| SDR-10 | B   | ✅     | **`saifdocs clear` now only deletes manifest-tracked files (2026-05-05).** Reads `<docspecDir>/.manifest.json`, deletes only `entry.output` paths that fall under `--output-dir`, prunes now-empty parent dirs up to (but not including) `--output-dir`. Behaviours verified: missing manifest → no-op (handwritten files survive); manifest entries outside `--output-dir` → ignored; stale entries (file already absent) → tolerated; `--docspec-dir` defaults to `docspec/` (cwd-relative). New `--docspec-dir` arg added. 152/152 saifdocs tests passing (6 new clear tests + the existing two updated for the new semantics); `pnpm run check` (lint + typecheck + knip + build + test) clean. CHANGELOG `[Unreleased]` updated with a Changed (BREAKING) entry. Unblocks DOC-09.2.                                                                                         | `vendor/saifdocs/src/cli/commands/clear.ts`, `vendor/saifdocs/src/cli/commands/cli-commands.test.ts`, `vendor/saifdocs/CHANGELOG.md` |
| SDR-11 | N   | ➡️     | **First-class asset support in saifdocs.** Mirror `docspec/assets/` → `docs/assets/` (or per-entry assets via `assets:` frontmatter that saifdocs computes a relative path for and injects into the agent's prompt). Removes the brittleness of body-instruction-based asset embedding (relative paths break when docspec layout shifts). **Deferred past v0.1**; body-instruction approach unblocks the migration.                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `vendor/saifdocs/src/{cli,docspec,manifest,generation}/`                                                                             |

</details>

---

## 4. Cross-cutting work items (don't fit one component)

<details open>
<summary>Show 10 work items</summary>

| ID   | Sev | Status | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Where                                                 |
| ---- | --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| X-01 | I   | ⚠️     | **Smoke-test matrix.** A single `pnpm test:smoke` (or CI job) that spins up a real container, runs the simplest possible feature against the top-3 LLM providers (Anthropic, OpenAI, Google), the top-3 agentic CLIs (claude, cursor, aider), and one of each language (node-vitest, python-pytest, go-gotest, rust-rusttest). Catches integration regressions before users do.                                                                                                                                                                                                                                                             | new CI job; rides on X-08 harness                     |
| X-02 | I   | ⚠️     | **Cost & token observability.** No telemetry today for tokens spent / dollars per run. For a tool that loops a coder agent up to `maxRuns × testRetries × phases × critics_rounds × 2` times, this is a basic affordance. Surface in `saifctl run get` and (later) the VS Code dashboard.                                                                                                                                                                                                                                                                                                                                                   | `src/cli/commands/run.ts`, `src/runs/`                |
| X-03 | I   | ➡️     | **Run telemetry / OTel export.** Hatchet emits workflow events; saifctl has no first-class hook to export to OTel/Sentry/Grafana. Document an env-var-driven OTel exporter at minimum. Deferred: paired with the gated Hatchet path (D-04); local-mode runs in `v0.1` produce small, inspectable logs without OTel.                                                                                                                                                                                                                                                                                                                         | `src/hatchet/`, `src/orchestrator/`                   |
| X-04 | I   | ⚠️     | **Provider SDK invocation tests** (related to NPM-06, CLM-04). After D-05 the test surface narrows to 4 native paths (Anthropic, Google, Google Vertex, OpenAI) plus one OpenAI-compatible route through `@ai-sdk/openai`. Mocked acceptance tests for each so a single SDK breaking change fails CI, not user runs. Open: live-call smoke test cadence (per-PR, nightly, or release-only?).                                                                                                                                                                                                                                                | `src/llm-config.ts`, `test/`                          |
| X-05 | I   | ➡️     | **Indexer (`shotgun`) packaging.** README references `--indexer shotgun` (Python sub-project, `uv run python -m shotgun.main`). Distribution story unclear — does the npm install pull it? is it a separate `pip install`? Document and unify. Deferred: shotgun is opt-in (`--indexer shotgun`); for `v0.1`, document it as an optional power-user feature with a separate install step. Full packaging unification is a `v1.0` concern.                                                                                                                                                                                                   | `README.md`, `vendor/shotgun/?`                       |
| X-06 | N   | ➡️     | **Helm chart** for the "Self-hosted and Kubernetes (Helm) deployment is underway" claim. Not blocking 0.1; blocking 1.0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | new chart dir; not yet present                        |
| X-07 | N   | ➡️     | **`saifctl validate` top-level config linter.** Schemas exist in `src/specs/phases/schema.ts` etc.; a single command that lints the whole project's `saifctl/` config (features, phases, critics, sandbox profiles) before a run would catch typos earlier than the per-feature loaders do today. Deferred: per-feature loaders already error on invalid config at load time; a unified `validate` command is a polish item for `v1.0`.                                                                                                                                                                                                     | `src/cli/commands/`, `src/specs/phases/schema.ts`     |
| X-08 | B   | 👍     | **Integration test harness.** A scaffold that lets us write tests which actually exercise the full path: spin up Docker, run an agent inside the container, hit a real LLM (provider hard-coded for simplicity — likely Anthropic since it's the default), assert on the resulting working tree / git history. Distinct from per-module unit tests (which mock the container) and from X-01 (which is a CI matrix that _uses_ this harness). Without X-08, X-08-P4's 70% coverage on the orchestrator + sandbox engine is unreachable, and X-01's smoke matrix has nothing to compose. **Decision D-07.** Implementation plan in §4.1 below. | new fixtures under `src/`, likely `test/integration/` |
| X-09 | I   | ➡️     | **Orchestrator state refactor.** Mutable module-level state in the orchestrator loop (own TODO at `src/orchestrator/loop.ts:676-681`: "hard to reason about… hard to decouple when moving to Hatchet workflow"). Refactor into an explicit context object before declaring `1.0`. Deferred: own TODO already targets `1.0`; refactor blocks Hatchet path which is also deferred (D-04). Relocated from NPM-08 on 2026-05-07 — cross-cutting infrastructure, not per-package work.                                                                                                                                                            | `src/orchestrator/loop.ts:676-681`                    |
| X-10 | I   | ➡️     | **Coverage uplift to 98%** across critical paths. Split out from X-08-P4 by **Decision D-07** — `v0.1` lands at 70% (X-08-P4); full uplift is `v1.0` hardening work. Relocated from NPM-20 on 2026-05-07.                                                                                                                                                                                                                                                                                                                                                                                                                                   | `vitest.config.ts:13-20`                              |

</details>

### 4.1 X-08 implementation plan — integration test harness (`X-08-P*`)

X-08 (above) is the load-bearing piece of phase 06: without a working
harness, X-08-P4's 70% coverage target on orchestrator + sandbox engine
is unreachable, and X-01's smoke matrix has nothing to compose. The
plan below sequences the work into discrete phases that each produce a
running, asserting test before the next is started.

**Locked decisions (sub-D-07):**

- **Sandbox profile for v0.1 fixtures: `node-pnpm`.** One profile, one
  test image (`saifctl-test-node-pnpm:latest`). Generalising across
  the 27 sandbox profiles is X-01's job, not X-08's.
- **Hard-coded provider: Anthropic, model `claude-haiku-4-5`.**
  Matches the existing live-call pattern at
  `src/llm-config.smoke.test.ts:58`. Override via `SAIFCTL_TEST_MODEL`
  env var if a future scenario needs a smarter model.
- **Two-axis env gating with run-by-default semantics:**
  - `SAIFCTL_INTEG=1` — opt in to Docker-running scenarios. When set, **all**
    integration scenarios run, including LLM-bearing ones. Missing
    `ANTHROPIC_API_KEY` causes the scenario to fail loudly (not silent-skip)
    so a misconfigured CI never goes unnoticed.
  - `SAIFCTL_NO_LLM=1` — explicit opt-out for LLM-bearing scenarios; combine
    with `SAIFCTL_INTEG=1` for per-PR CI runs that don't carry secrets.
  - `SAIFCTL_TEST_RETRY=N` — within-run retry budget for `itWithLLM`
    scenarios (default 0). Weekly CI sets `2` for transient-blip protection;
    debug-only scenarios ignore it.
  - Per-PR CI sets `SAIFCTL_INTEG=1 SAIFCTL_NO_LLM=1`; weekly CI sets
    `SAIFCTL_INTEG=1 SAIFCTL_TEST_RETRY=2` with `ANTHROPIC_API_KEY` in env.
    Per D-07: "scope LLM calls to one scheduled job, not per-PR."
- **In-process invocation, not subprocess.** Tests call `runStart`
  (and `runSandbox`) directly — same call site as
  `src/cli/commands/feat.ts:759`. This is what makes orchestrator +
  sandbox engine modules reachable for coverage.

**Phases:**

<details open>
<summary>Show 8 phases</summary>

| Item    | Sev | Status | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------- | --- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X-08-P1 | B   | ✅     | **Phase 1: scaffold + debug-agent smoke.** `runHarness()` API, env gates, tmp-project setup, container cleanup, git/tree assertions, dummy-feature fixture. One scenario: `agent: 'debug'` (no LLM key required) boots a container, runs a no-op task, tears down cleanly. Catches Docker plumbing regressions per-PR under `SAIFCTL_INTEG=1`. **Shipped 2026-05-05; ~7s wall-clock end-to-end.** Wiring up the harness surfaced two pre-existing upstream bugs: (a) `synthesizeMergedTestsDir` namespaced specs under `public/<label>/` even when only one source contributed content, breaking `../helpers.js` relative imports — resolved by switching to a per-source label-rooted layout (`<merged>/<label>/{public,hidden,helpers.ts,infra.spec.ts}`) in `src/orchestrator/test-scope.ts`; (b) the Docker engine bind-mounted four individual sub-paths (`public/`, `hidden/`, `helpers.ts`, `infra.spec.ts`) which broke the moment (a) changed the merged-dir shape — replaced with a single `${testsDir}:${containerTestsDir}:ro` bind in `src/engines/docker/index.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `test/integration/harness/`, `test/integration/scenarios/sandbox-mode-debug.integration.test.ts`, `src/orchestrator/test-scope.ts`, `src/engines/docker/index.ts`                                                                                                                                                                                                                                                                                                                                                                                              |
| X-08-P2 | B   | ✅     | **Phase 2: real LLM happy path.** One scenario: `agent: 'claude'` + `provider: 'anthropic'` against the dummy feature → asserts `dummy.md` exists on the produced feature branch with H1 + Purpose + Structure + Next Steps, ≥1 commit beyond `main`, and no API key leak in any captured log surface. Runs weekly via `pnpm test:integration:llm` (X-08-P3 wired the schedule). Closes the load-bearing leg of D-07. **Shipped 2026-05-05; ~30-90s wall-clock cached.** Surfaced and fixed five distinct upstream issues that none of the existing unit/smoke tests caught: **(1) Promise.all deadlock + missing done-signal** — `runCodingPhase`'s `await Promise.all([engine, driver])` hung for 15 min when the coder shell died without writing the `subtask-done` handshake file; resolved with `wireEngineExitedAbort` + new `SAIFCTL_ENGINE_EXITED_REASON` constant + `trap EXIT` belt-and-braces in `coder-start.sh`. **(2) Leash MITM CA env stripped by `runuser -l`** — `NODE_EXTRA_CA_CERTS` / `SSL_CERT_FILE` / `REQUESTS_CA_BUNDLE` / `CURL_CA_BUNDLE` didn't survive the privilege drop, so npm's claude-cli install failed with `SELF_SIGNED_CERT_IN_CHAIN`; resolved by adding `SAIFCTL_TLS_ENV_NAMES` to the central `saifctl_unpriv_env_whitelist` (auto-fixed all 14 DROPS_PRIVILEGES agents in one go). **(3) `LLM_MODEL` semantics ambiguity** — factory's `provider/model` form (correct for LiteLLM-style multi-provider agents) is rejected by single-vendor native CLIs; introduced parallel `LLM_MODEL_ID` env var (bare model id, mirrors `LlmConfig.modelId` 1:1) and switched 6 native CLIs (claude, codex, gemini, copilot, cursor, qwen) + deepagents (whose existing colon-translation logic was silently doubling the prefix `anthropic:anthropic/claude-…`). **(4) `runuser -l` cwd reset** — login shell defaults cwd to user's `$HOME` (`/home/saifctl`), so agents resolved task-prompt relative paths against the wrong dir and reported "file does not exist"; added `cd "${SAIFCTL_WORKSPACE_BASE:-/workspace}"` to all 14 DROPS_PRIVILEGES agent.sh files + whitelisted the env var. **(5) Forge format ambiguity documented** — provider-dependent (bare for OpenAI, prefixed for HuggingFace), no universally-right translation; documented the gotcha + escape hatches (`.forge.toml` `model_id` or `--agent-env LLM_MODEL=<bare>`) in `forge/agent.sh` rather than guessing. **Two new ratchet tests** in `drop-privileges-contract.test.ts` (TLS-env forwarding + cwd handshake) prevent regression. **One new diagnostic test** in `run-coding-phase.test.ts` reproduces the deadlock pattern and fails fast (< 1s) if the cross-link is removed. **Harness instrumentation**: `<tmpProjectDir>/harness.log` mirror via synchronous `writeSync` so logs survive vitest test timeouts, plus `pnpm test:integration:llm:debug` script for live verbose output. **800/800 unit tests + Phase 1 integration green.** | `test/integration/scenarios/dummy-claude-anthropic.integration.test.ts`, `src/orchestrator/phases/run-coding-phase.ts` (+ `.test.ts`), `src/orchestrator/scripts/{coder-start,saifctl-agent-helpers}.sh`, `src/agent-profiles/{claude,codex,gemini,copilot,cursor,qwen,deepagents,aider,openhands,opencode,kilocode,terminus,mini-swe-agent,forge}/agent.sh`, `src/orchestrator/agent-env.ts`, `src/runs/types.ts`, `src/agent-profiles/drop-privileges-contract.test.ts`, `test/integration/harness/{runHarness.ts,setup/stdio-capture.ts,setup/env-gate.ts}` |
| X-08-P3 | I   | ✅     | **Phase 3: CI integration.** Per-PR workflow (`tests-integration.yml`) runs P1 (debug only) under `SAIFCTL_INTEG=1 SAIFCTL_NO_LLM=1`; weekly workflow (`tests-integration-weekly.yml`, Mondays 06:00 UTC + `workflow_dispatch`) runs P1 + P2 under `SAIFCTL_INTEG=1` with `secrets.ANTHROPIC_API_KEY` and `SAIFCTL_TEST_RETRY=2` for in-process flake protection. Both jobs build the coder image (`saifctl-coder-node-pnpm:latest`) and test image (`saifctl-test-node-vitest:latest`) fresh from the in-tree Dockerfiles per run, so a Dockerfile regression that landed during the week surfaces on Monday rather than waiting for the next release. Per-PR uses `paths-ignore` to skip docs/web/extension-only PRs and `concurrency.cancel-in-progress` to drop superseded runs; weekly is single-fire. Failure-only artifact upload pulls `<tmp>/saifctl-integ-*/harness.log` mirrors out for triage (7-day retention per-PR, 30-day weekly). **Cadence note:** moved from nightly → weekly because the LLM happy path moves slowly and weekly cuts cost ~7× while keeping signal latency tolerable; `SAIFCTL_TEST_RETRY=2` (read by `itWithLLM`) replaces the previous "retry across days" sketch with within-run retries scoped to LLM scenarios — debug-agent failures are deterministic plumbing failures and surface on first hit. **`SAIFCTL_TEST_SKIP_NETWORK_PROBE`** intentionally left unset on both workflows: GitHub-hosted runners have egress, and the debug-agent probe exercises Cedar/Leash NetworkConnect, which is the smoke's stated purpose. Project-level Anthropic budget alert (~$20/mo tripwire) configured out-of-band in the Anthropic console; expected spend ≈ $0.20/mo (4 runs × ~$0.05 typical).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `.github/workflows/tests-integration.yml`, `.github/workflows/tests-integration-weekly.yml`, `test/integration/harness/setup/env-gate.ts`                                                                                                                                                                                                                                                                                                                                                                                                                      |
| X-08-P4 | I   | ➡️     | **Phase 4: coverage uplift (absorbs former NPM-07).** Raise `vitest.config.ts` thresholds to 70/65/70/70 once P1+P2 are stable for ≥1 week. Confirm `pnpm coverage` includes integration runs. Update the TODO at `vitest.config.ts:18` to reference X-10 (98% v1.0 target) only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `vitest.config.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| X-08-P5 | I   | ➡️     | **Phase 5: additional scenarios.** Gate-script-failure (uses `scripts/gate-dummy-fail.sh`, asserts retry+feedback loop), extract-modes (parametrised over `none`, `host-apply`, `host-apply-filtered` — the three real `SandboxExtractMode` values from `src/orchestrator/phases/sandbox-extract.ts`), secret-leak hardening. Bridges to X-01 (matrix parametrisation) and X-04 (provider-invocation tests on the same fixtures).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `test/integration/scenarios/*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| X-08-P6 | I   | ✅     | **Phase 6: project-level tests scaffolding.** `synthesizePlanSpecSubtaskInputs` declares `<projectDir>/saifctl/tests/` in every run's `testScope.include`, but no generator wrote into that path — features got scaffolded `helpers/infra` from the test profile's templates while the project-level always-immutable suite had no on-ramp. **Resolved:** (a) lifted `readTemplate` into `src/test-profiles/templates.ts` (shared between feature- and project-level scaffolders); (b) added `exampleFilename` to `TestProfile` and a runnable, edit-in-place example template under each profile's `templates/`; (c) `generateTests` now writes the example alongside helpers/infra (idempotent, `--force` overwrites); (d) new `src/test-profiles/scaffold-global-tests.ts` writes helpers + infra + example into `<saifctl>/tests/` with a cross-language guard (refuses to mix `helpers.py` with `helpers.ts` etc. without `--force`); (e) `saifctl init` now scaffolds project-level tests on bootstrap; (f) new `saifctl init tests` subcommand for retroactive / profile-switch scaffolding; (g) `forceArg` lifted to `src/cli/args.ts` so init and feat share one definition. **15 + 4 new unit tests; full unit suite remains green.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `src/test-profiles/{templates,scaffold-global-tests}.ts`, `src/test-profiles/*/templates/example*`, `src/cli/commands/init.ts`, `src/cli/args.ts`                                                                                                                                                                                                                                                                                                                                                                                                              |
| X-08-P7 | B   | ✅     | **Phase 7: Claude root-user fix (P2 was hanging here).** P2's first end-to-end run blew the 15-min timeout because Claude Code 2.x refuses `--dangerously-skip-permissions` when running as root for security reasons, and the saifctl coder containers default to root (Leash bootstrap mounts `/leash`, `/log`, `/cfg` are root-owned on the host and unreadable to a non-root container — so simply switching `USER` repo-wide breaks the foundation). **Resolved:** drop privileges only for the agent invocation. (a) Every `Dockerfile.coder` now pre-creates a `saifctl` user + npm-global prefix and exports `SAIFCTL_UNPRIV_USER` / `SAIFCTL_UNPRIV_NPM_PREFIX`; (b) `src/agent-profiles/claude/agent-install.sh` `runuser`s into `saifctl` to install `@anthropic-ai/claude-code` into that prefix; (c) `src/agent-profiles/claude/agent.sh` `runuser`s into `saifctl` for the actual `claude -p` invocation, forwarding `ANTHROPIC_API_KEY` / `LLM_MODEL` via env-whitelist; (d) container default stays root so Leash continues to work for all other code paths; (e) **Linux UID realignment** in agent.sh — before `runuser`, `usermod -u <stat /workspace>` aligns saifctl's UID to the bind-mount owner, working transparently on macOS Docker Desktop (UID translation) and Linux (strict 1:1 UID mapping); the standard "fix-attrs" pattern from gosu/tini; (f) two new contract tests guard against regression: `src/sandbox-profiles/scaffold-contract.test.ts` asserts every Dockerfile.coder ships the scaffold, `src/agent-profiles/drop-privileges-contract.test.ts` asserts claude drops privileges + realigns UID and that any future agent which drops privileges also realigns. **Verified end-to-end inside the container**: `claude --dangerously-skip-permissions` no longer trips the root guard (`permissionMode: "bypassPermissions"` in stream-json, then a normal auth-failure on the test key — proving the agent is fully reachable). P1 (debug) remains green at 7s. Scope kept narrow to claude only; symmetric drop-privileges across all other agent profiles is tracked as **X-08-P8**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `src/sandbox-profiles/*/Dockerfile.coder` (24), `src/agent-profiles/claude/{agent.sh,agent-install.sh}`, `src/sandbox-profiles/scaffold-contract.test.ts`, `src/agent-profiles/drop-privileges-contract.test.ts`                                                                                                                                                                                                                                                                                                                                               |
| X-08-P8 | I   | ✅     | **Phase 8: symmetric drop-privileges across all agent profiles.** Pre-P8 only `claude` ran unprivileged (X-08-P7); the other 14 profiles ran as root. **Resolved:** every agent profile that performs LLM work now drops privileges to `$SAIFCTL_UNPRIV_USER` for both install and invocation, leaving Leash's privileged bootstrap mounts untouched. (a) New shared helper `src/orchestrator/scripts/saifctl-agent-helpers.sh` exposes `saifctl_assert_unpriv_env`, `saifctl_realign_unpriv_uid`, `saifctl_drop_privs_init`, and `saifctl_unpriv_env_whitelist` — sourced by every agent.sh / agent-install.sh, mounted at `/saifctl/saifctl-agent-helpers.sh` via the orchestrator's existing copy list (`src/orchestrator/sandbox.ts:421-426`). (b) Group A — npm-install-g (codex, copilot, gemini, kilocode, opencode, qwen): install via `runuser -l saifctl … npm install -g …` into `$SAIFCTL_UNPRIV_NPM_PREFIX`; agent.sh wraps the CLI in `runuser -l … --whitelist-environment=…`. (c) Group B — uv-tool-install (aider, deepagents, mini-swe-agent, openhands, terminus): install via `runuser -l saifctl … uv tool install …` into saifctl's `$HOME/.local/bin`; dropped the previous pip/pipx fallback complexity (errors out with a clear pointer when uv is absent). (d) Group C — curl-binary (cursor, forge): the official install scripts run via `runuser` so the binary lands in saifctl's `$HOME/.local/bin`. (e) **Terminus's tmux dependency** is installed _before_ dropping privileges (apt/dnf/pacman as root), then the script source-and-realigns. (f) `debug` stays root — it ships a no-LLM agent used by the X-08 harness specifically to exercise the root code path so regressions there surface in P1. (g) `DROPS_PRIVILEGES` set in `drop-privileges-contract.test.ts` updated to include all 14 LLM agents; only `debug` remains in `ROOT_OK_ALLOWLIST`. **6 contract tests + bash-syntax check on all 30+ migrated scripts pass; 792/792 unit tests + Phase 1 integration green.** Smoke verification: `codex --version` runs as saifctl in the rebuilt node-pnpm coder image. End-to-end agent runs against real LLMs are deferred to X-01 (smoke matrix), as planned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `src/orchestrator/scripts/saifctl-agent-helpers.sh` (new), `src/orchestrator/sandbox.ts` (copy list), `src/agent-profiles/*/agent.sh` (15 — 14 migrated + claude refactored to use the helper), `src/agent-profiles/*/agent-install.sh` (15), `src/agent-profiles/drop-privileges-contract.test.ts`                                                                                                                                                                                                                                                            |
| X-08-P9 | B   | ✅     | **Phase 9: Linux Docker UID/permissions compat for staging + test-runner containers.** P3's first weekly CI run failed with `staging-start.sh: cd: can't cd to /workspace`, then a cascading EACCES on `/test-runner-output/results.xml` from the test runner, and a third EACCES on `.pnpm-store/` during host-side cleanup. Diagnostic instrumentation revealed the proximate cause: GitHub Linux runners use umask 077 for the `runner` user (a deliberate hardening not present on macOS), so Node's `mkdir(codePath, { recursive: true })` produced the run-specific sandbox dir at mode 0o700 owned by the runner UID 1001. The staging + test-runner containers run with `CapDrop:['ALL']` (no `DAC_OVERRIDE`/`DAC_READ_SEARCH`), so root inside the container is treated as "other" for DAC checks, and 0o700 grants nothing to "other" → can't even traverse. macOS Docker Desktop's UID translation hides all three symptoms locally. **Resolved:** (a) `src/orchestrator/sandbox.ts` now passes explicit `mode: 0o755` to the `mkdir` calls + `chmod(sandboxBasePath, 0o755)` for defence against pre-existing parents. (b) `src/engines/docker/index.ts` now sets `User: \`${process.getuid()}:${process.getgid()}\`` on both the staging and test-runner `createContainer` calls — the container processes run as the same UID:GID as the host owner, so DAC checks align without any cap escalation. Replaced an earlier interim `User: 'saifctl'` change which didn't actually work on Linux because the image-baked `saifctl` user resolves to UID 1000 (from `useradd`) while the runner is UID 1001 — name resolution is image-side, perms are host-side, footgun. (c) `src/orchestrator/scripts/coder-start.sh` now `chown -R "$ws_uid:$ws_gid" /workspace` after startup + agent-install (both run as root in the coder for Leash compat), so the `.pnpm-store/` and `node_modules/` they create end up host-owned and don't poison subsequent staging/test reads or host cleanup. (d) Removed the diagnostic instrumentation in `staging-start.sh` (it served its purpose). (e) Workflow `sudo rm -rf /tmp/saifctl* /tmp/leash.code.*` cleanup step kept as belt-and-braces against future regressions. **No security regression** — `CapDrop:['ALL']` and `SecurityOpt:['no-new-privileges']` remain in place; the change is strictly about UID alignment, not capability widening. | `src/orchestrator/sandbox.ts:550-565`, `src/engines/docker/index.ts:267-310,422-435`, `src/orchestrator/scripts/coder-start.sh:391-410`, `src/orchestrator/scripts/staging-start.sh` |

</details>

**Pitfalls planned around (each materialises in code):**

1. **Sandbox dir collisions.** Default
   `/tmp/saifctl/sandboxes/{proj}-{feat}-{runId}` will race under
   parallel vitest. Mitigation: integration vitest config uses
   `pool: 'forks'` + `poolOptions.forks.singleFork: true`.
2. **Leaked containers on test crash.** Belt-and-braces `afterEach`
   prunes `leash-target-saifctl-test-*` and
   `leash-manager-saifctl-test-*` regardless of orchestrator
   `CleanupRegistry` state.
3. **Image build cost.** Tests assume both the coder image
   (`saifctl-coder-node-pnpm:latest`, from the harness's locked
   sandbox profile `node-pnpm`) and the test runner image
   (`saifctl-test-node-vitest:latest`, from the default test profile
   `node-vitest`) already exist. CI builds both once per workflow via
   `pnpm docker build coder --profile node-pnpm` and
   `pnpm docker build test --test-profile node-vitest`; tests never
   rebuild.
4. **API-key leakage.** P2 test asserts `process.env.ANTHROPIC_API_KEY`
   substring is not present in `result.logs.stdout`. Reuses the
   existing redaction layer.
5. **Top-level `describe.skip` cannot await.** Docker probe runs at
   module load via top-level `await` (allowed by vitest); falls back
   to `beforeAll` + `ctx.skip()` if a test runner upgrade later breaks
   that assumption.
6. **Flake on real LLM.** P2 wall-clock target 2–4 min; hard timeout
   900_000 ms (covers cold-cache runs). The weekly job sets
   `SAIFCTL_TEST_RETRY=2`, so `itWithLLM` retries up to 2× within the
   same run on transient Anthropic 5xx / network blips — flake
   protection without the cross-week silence a "wait for the next
   weekly to confirm" pattern would create.

**What this plan deliberately does _not_ do:**

- Generalise the harness across sandbox profiles, agent profiles, or
  providers. That's X-01.
- Move the provider-invocation tests under the harness. That's X-04
  (it can ride on the same fixtures, but lands separately).
- Add per-PR LLM tests. Per D-07, real LLM stays on the weekly scheduled
  job only.

**Touches:** X-08 (implementation slot), X-08-P4 (former NPM-07 scope),
X-01 (downstream), X-04 (downstream), D-07 (parent decision).

---

## 5. Decisions (capture as we go)

Decisions migrate up from §6 (Open questions) into this section as the
conversation closes them. Each entry: short name, rationale, and the
work-plan items it touches.

### D-01 — First public release tag is `v0.1.0` (alpha)

Rationale: positions the product as "use at your own risk", matches
internal expectations of remaining sharp edges (Argus dependency,
unrestricted-network default, untested agent CLIs), and reserves
`v1.0.0` for after a public soak period (4-8 weeks) during which we
gather real-world failure modes.

Touches: NPM-15, DOC-06, VSX-06, the §1.1 vs §1.2 launch-tier split.

### D-02 — Extension and CLI track independent SemVer trains

The extension and the npm CLI version on their own marketplace and npm
cadences. Extension declares **two** compatibility ranges:

1. `engines.vscode` (covers the editor) — already declared
   (`^1.86.0`).
2. A **`MIN_CLI_VERSION`** (or `cliCompat: "^X.Y.Z"`) constant in
   extension code — covers the saifctl CLI surface the extension
   shells out to.

On activation the extension probes `saifctl --version`, parses the
output, and compares against the declared compat range. On mismatch:
modal dialog "saifctl ≥ X.Y.Z required" with a one-click install /
upgrade action. Bump the compat range only when the extension consumes
a breaking CLI feature; patch-level CLI updates must not break the
extension. (Pattern in the wild: Prisma, Biome, Astro.) Don't pin to
an exact CLI version unless we genuinely depend on a specific commit.

For the v0.1.0 launch: both ship with version `0.1.0` and
`MIN_CLI_VERSION = "0.1.0"`. After that they decouple.

Touches: VSX-06, VSX-11.

### D-03 — Publish under the `@safe-ai-factory` org

Both npm and the VS Code marketplace publish under the
`safe-ai-factory` organization account, not under the maintainer's
personal account. Affects credibility, future handover, and shared
ownership.

Pre-launch verification:

- npm: org exists, current maintainer is owner with `publish` rights,
  `package.json:5-7` already has `publishConfig.access: public`.
- VS Code marketplace: publisher entity created, verified via Azure
  DevOps; `vscode-ext/package.json` `publisher` field updated from
  `JuroOravec` to `safe-ai-factory` (or whatever the marketplace
  identifier resolves to).

Touches: NPM-16, VSX-09.

### D-04 — Hatchet integration is gated for v0.1.0

The Hatchet code path stays in the codebase but is hidden behind a
feature flag (off by default). Two surfaces:

1. **CLI / orchestrator.** When the flag is unset and Hatchet code
   would run (today: `run resume` along the Hatchet path), surface a
   single, clear error: `"Hatchet integration is not yet available in
v0.1.0. Use local mode (default) or enable the experimental flag
SAIFCTL_EXPERIMENTAL_HATCHET=1."` Replace the current
   `throw new Error("Hatchet + 'run resume' path does not work yet.")`
   with this message.
2. **README / web copy.** Hatchet appears under a "Coming soon"
   section, not under "Requirements" or "Features". The phrase
   "distributed runs" disappears from launch marketing.

Local mode (`LocalHatchetRunner`) keeps working unchanged — that's
the default path.

Rationale: matches D-01's alpha posture; lets us ship without fixing
the resume path; preserves the architectural investment for v1.0.

Touches: NPM-03, CLM-07.

### D-05 — Drop 15 of 19 AI-SDK provider deps; route everything else through OpenAI-compat

Keep four native SDKs only:

- `@ai-sdk/anthropic` — Anthropic does not expose an OpenAI-compatible
  endpoint, and Claude is the default provider for auto-discovery.
- `@ai-sdk/google` — Google Generative AI (Gemini) is also non-compat.
- `@ai-sdk/google-vertex` — Google Vertex is non-compat; needed for
  enterprise users who require Vertex over the public Gemini API.
- `@ai-sdk/openai` — OpenAI itself, plus the universal compat client
  for everyone else.

Drop the other 15 (`alibaba`, `baseten`, `cerebras`, `cohere`,
`deepinfra`, `deepseek`, `fireworks`, `groq`, `huggingface`, `mistral`,
`moonshotai`, `perplexity`, `togetherai`, `vercel`, `xai`). Refactor
`createProviderModel()` (`src/llm-config.ts`) so non-native providers
route through `@ai-sdk/openai` with a `baseURL` override per provider.
Two providers already use `createOpenAI` with a base URL today
(`openrouter` line 175, `ollama` line 284) — extend that pattern.

**Why this branch and not "drop all 19":** the user originally
suggested possibly dropping every provider SDK in favor of a single
OpenAI-compatible client. The audit found that Anthropic, Google, and
Vertex genuinely require their native SDKs (no OpenAI-compat
endpoint), and Anthropic in particular is the default — losing it
breaks the out-of-box quickstart. The keep-4 path achieves ~95% of
the install-size win (~1.5–2 MB of `node_modules` removed) and 100%
of the supply-chain audit-surface reduction we care about for the 15
infrequently-used providers, without breaking the default path.

**Why not lazy-load all 19:** Lazy loading helps cold-start cost but
not install size, audit surface, or `package.json` clarity — those
are the actual problems. If we can structurally remove the deps,
that's strictly better than deferring the load.

**Marketing copy implication:** the README, the web saifctl page, and
the docs all say "All major LLM providers" or imply 19/20. After
D-05 the literal claim becomes "OpenAI-compatible API + native
Anthropic, Google (Generative AI), and Google Vertex support" —
which is honest and shorter. CLM-04 captures the copy sweep across
all surfaces.

Touches: NPM-06 (the dep removal + refactor), CLM-04 (marketing copy
sweep), X-04 (test surface narrows from "20 providers" to "4 native
paths + 1 compat route").

### D-06 — Cedar default policy stays unrestricted; document threat model

Keep the current `default.cedar` rule that permits all outbound
network. Do not switch to an allowlist as the default.

Rationale: the agent legitimately needs network for LLM APIs, package
registries (npm, PyPI, crates.io, Go module proxy), git hosts, and
container registries. An allowlist that covers all of these and works
for arbitrary user projects is intractable to maintain. The real
isolation guarantee is **filesystem-as-boundary** — Cedar forbids
writes to `/workspace/.git/hooks/` and `/workspace/.git/config` (no
host-hook escape via the two .git/ paths the host's git ops would
honour as code; other .git/ writes are allowed so the in-container
reviewer can commit) and to `/workspace/saifctl/` (no reward-hacking),
and the workspace itself
is a copy that gets diff-extracted on success. The agent can read
its own env vars and exfiltrate them over the network if it's
exploited, but that's a known trade-off, not an oversight.

**The user-facing artifact for this decision is `docs/security.md`.**
Required contents:

1. Threat model — what saifctl protects against, and what it doesn't
   (host filesystem ✅, agent process integrity ✅, host secrets ✅;
   data-exfiltration via network ❌, kernel exploits in Leash/eBPF ❌,
   supply-chain attacks against the agent's CLI tool ❌).
2. Filesystem-as-boundary rationale — why the network is intentionally
   unrestricted by default.
3. Cedar policy override surface — `--cedar <path>` flag, the bundled
   `deny-network.cedar` example, and how to author a custom policy.
4. The `dangerousNoLeash` mode and when it's appropriate (debug only).
5. Pointer to `docs/leash-access-control.md` for policy authoring.

Top-level `SECURITY.md` shrinks to just the responsible-disclosure
pointer (email + GPG fingerprint, "please don't open public issues for
security bugs").

Touches: DCK-02 (the policy default itself — keep), CLM-05 (marketing
"zero-trust" rephrase), DOC-04 (write `SECURITY.md` short version),
DOC-05 (write `docs/security.md` long version + `docs/leash-access-control.md`).

### D-07 — Two-tier coverage targets, with an integration test harness as prerequisite

The blanket "coverage threshold" question splits into three pieces:

1. **`v0.1` coverage target: 70%** on critical paths (orchestrator,
   CLI, sandbox engine, the four kept LLM providers from D-05).
   Tracked in `vitest.config.ts:13-20`. (X-08-P4; relocated from
   NPM-07 on 2026-05-07.)
2. **`v1.0` coverage target: 98%** — the original TODO. Deferred to
   the hardening cycle. (X-10, ➡️; relocated from NPM-20.)
3. **Integration test harness** — net-new work for `v0.1`. A scaffold
   that genuinely runs through the hoops: spins up Docker, runs an
   agent in the container, hits a real LLM (provider hard-coded for
   simplicity — most likely Anthropic since it's the default after
   D-05), and asserts on outcomes. (X-08.)

The test harness is the load-bearing piece. Without it:

- X-08-P4 (70% on orchestrator + sandbox engine, former NPM-07) is
  unreachable — those modules' "happy path" only exists in
  real-container runs; unit tests on them mock too much to count.
- X-01 (smoke-test matrix across providers × CLIs × languages) has
  nothing to compose. The matrix is a _parametrization_ of harness
  invocations.
- X-04 (provider SDK invocation tests after D-05) lands cleaner if it
  can ride on the same fixtures.

Hard-coding the provider in fixtures is deliberate: real LLM calls in
CI are slow + expensive + flaky. The harness's value isn't "exercise
every provider"; it's "exercise the orchestrator-sandbox path with a
provider that's known to work." Anthropic is the natural default.

For LLM calls in CI: scope to one nightly job (or release-tagged
job), not per-PR. Per-PR tests should mock the LLM at the
`LanguageModelV3` boundary.

Touches: X-08-P4 (former NPM-07; `v0.1`-scoped at 70%), X-10 (former
NPM-20; `v1.0`-scoped at 98%), X-08 (the harness itself), X-01 + X-04
(now downstream of the harness).

### D-08 — Repo-root directory taxonomy

The four stray dirs originally bundled into NPM-09 turn out to have
distinct rationales. Each gets its own item, treated atomically:

| Dir               | Rationale                                                                                                                              | Action for `v0.1`                                                                                                                                              | Item   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `dist-pack/`      | Leftover packaging artifact, no purpose.                                                                                               | Delete.                                                                                                                                                        | NPM-09 |
| `npm-tombstones/` | **Defensive** — registered package names parked to prevent typo-squat / supply-chain attacks against the `@safe-ai-factory` namespace. | Keep. Add `npm-tombstones/README.md` documenting the rationale + add to `.npmignore`.                                                                          | NPM-17 |
| `docs_old/`       | In-flight migration material being moved to `saifdocs`.                                                                                | Conceptually transplant every note / idea / concept (not word-for-word) into `saifdocs`, then delete. The bar is conceptual coverage, not 1-to-1 file mapping. | NPM-18 |
| `vendor/`         | Upstream sources (`argus`, `leash`, `saifbox`, `saifdocs`, `dev-containers-manifests`) we may need to build and ship ourselves.        | Per-vendor decision. **`argus` specifically links to Q-03** — vendoring it is path-(d) and would resolve CLM-01 by making the reviewer gate work out-of-box.   | NPM-19 |

NPM-09 was originally I-severity self-explanatory ("audit and clean").
After this taxonomy it's clear three of the four are blockers (B):
`dist-pack/` is a small but real publish hygiene issue; the
tombstones need disclosure; `docs_old/` is a real content gap that
we've been pretending doesn't exist; `vendor/` decisions partially
unblock Q-03.

Touches: NPM-09 (narrowed), DOC-10 (deferred; relocated from NPM-10),
NPM-17, NPM-18, NPM-19, Q-03 (new path option (d) — vendor argus).

### D-09 — Node 22 LTS as the minimum runtime

The repo had three different declarations: README "22+",
`package.json:engines` `>=20`, CI matrix `25`. Pick **Node 22 LTS** as
the supported runtime and propagate everywhere.

Rationale: Node 22 is current LTS (active maintenance through 2026,
maintenance through 2027); Node 25 is the current "current" line,
not LTS. Node 20 reaches maintenance in late 2024 and EOL in 2026 —
not a defensible minimum for a new product launching in 2026. Node 22
is the right floor: ESM and modern web APIs are stable, and we don't
have to support both v20 and v22 quirks.

Concrete changes:

- `package.json` — `"engines": { "node": ">=22.0.0" }`.
- `README.md` Requirements — "Node.js 22 LTS+".
- CI matrix — pin to Node 22 (drop the 25 line; we are not testing
  the bleeding edge).
- Any local `.nvmrc` / `.tool-versions` if present.

Touches: NPM-04.

### D-10 — Resolve all README TODOs by filling them in; write `docs/spec-driven-development.md`

The README has three open `<!-- TODO -->` comments. **The resolution
is to fill them in, not strip them out** — they advertise capability
we have, and removing them removes the advertised capability.

1. **Line 87 — `<!-- TODO - LINK TO MARKETPLACE -->`.** Becomes a
   real marketplace link once VSX-09 (org publisher) and the first
   marketplace publish ship. Phase 05 dependency.
2. **Line 88 — `<!-- TODO - EMBED VIDEO OR SCREENSHOT -->`.** The
   PNGs in `web/x_design/` are **stale** (app has moved on) and the
   directory must stay out of git per WEB-06. Fresh capture is
   human-only work, tracked as **PRE-01** in §3.0.1. The README only
   needs _one_ hero image; the web saifctl page is where the full
   set should land.
3. **Line 114 — `[Spec-driven development](./docs/spec-driven-development.md) <!-- TODO -->`.** Write the doc — see DOC-08.

`docs/spec-driven-development.md` is a step-by-step tutorial: walk
the reader through building a feature from an empty directory,
adding files in the order they're needed, explaining _why_ each one
shows up. Less detailed and less opinionated than `SKILL.md` (which
is the reference manual for agents driving the workflow). Examples
should be short and point at `SKILL.md` and the runnable
`saifctl/features/_phases-example/` for depth.

Approximate target shape (subject to refinement when authoring):

```
1. What spec-driven development means in saifctl
2. Anatomy of a feature directory (empty → spec → phases → critics)
3. Walkthrough: building a small feature end-to-end
   3a. `mkdir saifctl/features/<name>/`
   3b. Write `specification.md` (point at SKILL.md §4 for structure)
   3c. (Optionally) `feature.yml` for critic / test config
   3d. Cut phases: `phases/01-…/spec.md`
   3e. (Optionally) critics: `critics/audit.md`
4. Running it: `saifctl feat run <name>`
5. Observing it: `saifctl run inspect`, the VS Code sidebar
6. Where to go next (link to SKILL.md, _phases-example/, _phases-and-critics/)
```

Tone: explanatory, not prescriptive. The reader is evaluating
saifctl, not driving an agent.

Touches: NPM-05 (the README sweep), DOC-08 (the new doc), VSX-09 +
phase 05 (marketplace link dependency), WEB-06 (image asset
dependency).

### D-11 — Publishing flow + `package.json` export

Two unrelated micro-decisions bundled because they sit in the same
`package.json` neighborhood and were resolved by a single
investigation.

**Publishing flow (NPM-14).** Unify to **one flow**: both local
verification and CI publish go through `bash scripts/package.sh`.

- **Local verification:** `bash scripts/package.sh` runs
  `pnpm build && npm pack --pack-destination dist-pack/`. Inspect
  the output tarball (gitignored) before tagging a release.
- **CI publish:** the GitHub Actions workflow `publish-npm.yml`
  runs the same script, then publishes the _already-built tarball_:
  `npm publish ./dist-pack/safe-ai-factory-saifctl-<version>.tgz --access public`
  (the `./` prefix is required — without it npm misparses the path as
  a GitHub `<owner>/<repo>` shortcut and tries to clone it).

Why one flow: bit-identical artifacts between local verification and
CI publish. Eliminates the "works on my machine but CI publishes
something different" class of bug. **Drop `prepublishOnly` entirely**
— the script handles the build itself, so the hook is no longer
load-bearing. Document the single flow in `CONTRIBUTING.md` (DOC-03).

**`package.json` export (NPM-12).** Keep the
`"./package.json": "./package.json"` export entry. It is **not
redundant** — it's the standard idiom (used by React, Vite, Vue,
etc.) for letting downstream consumers read version metadata via
package-name resolution (`require('@safe-ai-factory/saifctl/package.json')`).

Investigation findings:

- saifctl's own `getSaifctlPackageVersion()` at
  `src/constants.ts:24` reads via `readFileSync(getSaifctlRoot()/package.json)`,
  bypassing the exports map. Removing the export wouldn't break
  internal use.
- `vendor/saifdocs/src/generation/run-sandbox.ts:22-25` carries a
  _stale_ comment claiming the export "is not listed in exports"
  and resolves via the package main instead. That comment was
  accurate at one point and isn't anymore — clean it up.
- No other consumer reaches the export.

Future external readers (saifbox, downstream tools, telemetry
collectors) benefit from being able to import the version without
filesystem gymnastics. The export costs nothing to keep.

Touches: NPM-12 (keep export, remove stale saifdocs comment),
NPM-14 (publish flow documented in CONTRIBUTING).

### D-12 — `vendor/` per-subdir taxonomy (split NPM-19)

NPM-19 originally bundled all five `vendor/` subdirs into a single
"decide what to ship per vendor" row. Each subdir has its own answer
(or its own open question), so split into per-subdir rows under a new
`VND-` prefix in §3.7. NPM-19 retires to a cross-reference anchor.

Split summary:

| Subdir                                             | New ID | Status | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------- | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vendor/argus`                                     | VND-01 | ✅     | **Resolved 2026-05-04 via Decision D-14 (Q-15 → path d).** Org transfer done (PRE-09), saifctl URLs flipped to `safe-ai-factory/argus` + `argus-core-v*`, fork release.yml aligned with upstream's intended end-state, fork release `argus-core-v0.5.6` cut with all 7 binaries, doctor probe + README disclosure shipped, upstream PR [Meru143/argus#75](https://github.com/Meru143/argus/pull/75) opened. **VND-06** carries the deferred Phase-4 migration (➡️ until upstream merges + ships). |
| `vendor/leash`                                     | VND-02 | 👍     | **Re-investigation 2026-05-04** found upstream PR #71 HAS MERGED (commit `164015b`), but no tagged release contains the fix yet. Watch upstream releases; once a tag includes `164015b`, follow the removal plan in `vendor/README.md:221-234`.                                                                                                                                                                                                                                                   |
| `vendor/saifbox`                                   | VND-03 | ✅     | Folded into saifctl as "Sandbox mode" (D-20). Shipped 2026-05-07 via WEB-08 + NPM-21.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `vendor/saifdocs`                                  | VND-04 | ✅     | **Decoupling refactor + publish complete 2026-05-04.** Saifdocs is now a _compiler_ that emits a saifctl feature tree (one phase per file-to-generate, plus an `audit` critic) with no runtime saifctl dep. Decisions D-17 (Q-13: yes refactor) and D-18 (Q-12: independent publish). All §3.8 SDR-\* items closed; `@safe-ai-factory/saifdocs@0.1.0` published via OIDC.                                                                                                                              |
| `vendor/dev-containers-manifests`                  | VND-05 | ✅     | Resolved per **D-13** — content moved, adjusted, into `vscode-ext/docs/cursor-vs-vscode-remote-containers.md`; raw JSON dumps dropped; `vendor/dev-containers-manifests/` deleted.                                                                                                                                                                                                                                                                                                                |
| (saifctl-side) Phase 4 — migrate to upstream argus | VND-06 | ➡️     | Deferred until upstream PR merges _and_ upstream cuts a tagged release with binaries. Concrete code changes documented in the row.                                                                                                                                                                                                                                                                                                                                                                |

The first investigation (the one I did before this re-check) was lazy:
it compared HEAD against a stale local `upstream` remote that hadn't
been fetched. The corrected picture above replaces it. **Practical
upshot:** both forks are now on a glide path _toward_ deletion — argus
needs one upstreamable PR (musl) or a base-image swap to become
unnecessary; leash just needs upstream to cut a release.

Touches: NPM-19 (narrowed to anchor), VND-01..VND-05, Q-03 (adds
path-(e)), Q-11..Q-14 (new), CLM-01 (re-framed: argus is
auto-downloaded, not absent).

### D-13 — Relocate `vendor/dev-containers-manifests/` to `vscode-ext/docs/` as a single adjusted doc

Resolves Q-14. Picks option (b) (co-locate with the consumer code).

The original directory bundled four large JSON manifest dumps
(~147 KB) plus two markdown files (`README.md` with reproduction
steps, `COMPARISON.md` with the actual analysis). Investigation
(VND-05) found the markdown is the durable artifact; the JSONs are
point-in-time snapshots that age fast (Cursor and MS both ship
frequent updates) and are easily regenerated.

Concrete shape:

- New file: `vscode-ext/docs/cursor-vs-vscode-remote-containers.md`
  (single doc, ~9 KB).
- §1 Why this doc exists; §2 Headline finding (the
  "No container id found" Cursor quirk); §3 Other notable
  differences (lifted from COMPARISON.md tables); §4 Reproducing
  the comparison (lifted from README.md instructions);
  §5 When to revisit (new — explicit trigger conditions);
  §6 Source snapshots (explains why the JSON dumps are not
  checked in).
- Front matter pins **Last verified: 2026-04-01 / MS 0.452.0 /
  Cursor 1.0.32** so future readers can judge staleness at a
  glance.
- `vscode-ext/src/inspectAttach.ts` inline comments slimmed and
  cross-link to the new doc — keeps the comments concise without
  losing discoverability from the consumer.
- The four raw JSON dumps are dropped from git (~147 KB removed).
- `vendor/dev-containers-manifests/` deleted entirely.

**Why option (b) over (a) / (c):**

- (a) `docs/development/ide-extensions/` would scatter the doc
  away from its only consumer (`vscode-ext/src/inspectAttach.ts`).
  Whoever next edits inspectAttach.ts wants the reference one
  directory up, not in a sibling project's docs tree.
- (c) external blog post / wiki was tempting (the analysis is
  publishable-quality) but means the answer to "why does
  inspectAttach do this?" requires leaving the repo. Co-located
  doc loses the "publish externally" angle but keeps every
  in-repo question answerable in-repo. (Nothing prevents a
  future blog post that links to the in-repo doc.)

Touches: VND-05 (✅), Q-14 (resolved → D-13).

### D-14 — `vendor/argus`: keep fork temporarily, fix the _actual_ upstream bug, align everything

Resolves Q-15. Picks path (d): submit a focused upstream PR that
restores binary releases AND adds musl targets, while keeping the
fork operational until upstream merges + ships.

**The actual upstream bug** turned out to be subtler than the first
investigation framed. Two re-checks were needed:

1. **First re-check (corrected the lazy initial audit)** found that
   3 of 4 fork-specific code changes had landed upstream via
   [Meru143/argus#64](https://github.com/Meru143/argus/pull/64) —
   binary release CI scaffolding, `argus-ai-v*` tag pattern, LLM
   base URL fix. Only musl targets remained fork-specific.
2. **Second re-check (corrected the corrected audit)** found that
   upstream's binary release pipeline has not actually worked
   since v0.2.2 (2026-02-16) — _no_ tagged release between v0.3.0
   and v0.5.5 ships binaries. Root cause: `release-plz.yml`
   pushes tags using `secrets.GITHUB_TOKEN`, and per
   [GitHub Actions' anti-recursion rule](https://docs.github.com/en/actions/using-workflows/triggering-a-workflow#triggering-a-workflow-from-a-workflow),
   bot-pushed tags do NOT trigger downstream workflows. So the
   tags exist but `release.yml` never fires. The `argus-ai-v*` →
   `argus-core-v*` trigger pattern question is real but secondary;
   even fixing the trigger wouldn't help while bot-pushed tags
   are silently suppressed.

**Resolution shape:**

1. **Upstream PR** — three commits in [Meru143/argus#75](https://github.com/Meru143/argus/pull/75):
   (a) `release-plz.yml`: change the `release` step's `GITHUB_TOKEN`
   env to `${{ secrets.GH_PAT || secrets.GITHUB_TOKEN }}`
   (matching the existing pattern on the `release-pr` step).
   Maintainer adds a `GH_PAT` repo secret with `repo +
    workflow` scopes.
   (b) `release.yml`: switch trigger from `argus-ai-v*` to
   `argus-core-v*` (consistent with release-plz's per-crate
   output; `argus-core` is always part of every release cycle).
   (c) `release.yml`: add musl Linux targets (`x86_64-unknown-linux-musl`,
   `aarch64-unknown-linux-musl`) using `cross` for the musl
   toolchain.
2. **Our fork (`safe-ai-factory/argus`)** — aligned with the same
   end-state: trigger `argus-core-v*`, `softprops/action-gh-release@v2`
   release-creation, musl targets present. Dropped fork-only
   optimizations (LTO/strip env, rust-cache, defensive packaging).
   Fork release `argus-core-v0.5.6` cut with all 7 archives.
3. **saifctl-side (`src/orchestrator/sidecars/reviewer/argus.ts`)**
   — URL pattern flipped to `argus-core-v${ARGUS_VERSION}` in both
   `ensureArgusBinary` and `probeArgusReleaseEndpoint`. README
   Requirements line discloses the network-fetch dependency.
   `saifctl doctor` HEAD-probes the endpoint and warns on
   unreachability.
4. **GitHub repo transfer** — `JuroOravec/argus` →
   `safe-ai-factory/argus` (PRE-09 ✅).

**Why path (d) over the other Q-15 options:**

- (a) Drop fork + GLIBC 2.39+ base image: doesn't work — without a
  source of binaries upstream, there's nothing to download from.
- (b) Submit musl-only PR: doesn't help — adding musl to a
  workflow that never fires is pointless.
- (c) Keep fork indefinitely: works today, but accumulates ongoing
  maintenance debt. (d) is the path that retires the fork.

**Investigation history preserved** in VND-01 row + this decision.
Both lazy passes are documented honestly so future readers see how
the conclusion shifted.

**VND-06 carries the deferred Phase-4 cutover** — once upstream PR
#75 merges _and_ upstream cuts a tagged release that ships
binaries, saifctl flips `REPO` from `safe-ai-factory/argus` to
`Meru143/argus` (one-line change), drops the submodule, and
optionally archives the fork.

Touches: VND-01 (✅), VND-06 (➡️), Q-15 (resolved → D-14), CLM-01
(✅), DCK-03 (partial ✅ — argus probe added), PRE-09 (✅).

### D-15 — Argus dependency: runtime download + mount (Q-03 path e)

Resolves Q-03. Locks in path (e) — the _current_ wired setup — as
the answer for `v0.1.0`.

What "path (e)" means concretely:

- The `argus` binary is **not bundled** in the saifctl npm tarball.
- It is **auto-downloaded** at runtime via `ensureArgusBinary()` at
  `src/orchestrator/sidecars/reviewer/argus.ts:33-46,88` (pinned to
  `ARGUS_VERSION = '0.5.6'`, fetched from
  `safe-ai-factory/argus` releases at `argus-core-v${ARGUS_VERSION}`).
- It is **cached** under `/tmp/saifctl/bin/` (override via
  `SAIF_REVIEWER_BIN_DIR`).
- It is **mounted** into the coder container at
  `/usr/local/bin/argus:ro`.

User-visible disclosures (path (a) recommendations from Q-03)
already shipped per D-14:

- README Requirements line discloses the network-fetch dependency
  and points at `--no-reviewer` for offline runs.
- `saifctl doctor` HEAD-probes the release endpoint and surfaces a
  clear warning if unreachable.

**Why path (e) over the others:**

- (a) "External requirement + doctor check": this _is_ what we ship
  — but with the binary auto-downloaded rather than a per-user
  install. (a) and (e) merge in practice; the disclosure language
  treats them the same.
- (b) "Replace with in-process reviewer": premature. argus is a
  serious tool (~5K LOC of Rust); a saifctl-owned in-process
  replacement would be a multi-month project for marginal value
  given (e) works.
- (c) "Defer Reviewer to v1.0": the gauntlet's three-stage story is
  load-bearing for the marketing narrative. Skipping the Reviewer
  for v0.1 weakens that.
- (d) "Vendor argus into the coder Docker image": the npm-tarball
  size benefit is the same as (e); the trade-off is that (d) ties
  argus releases to saifctl Docker image rebuilds, while (e) lets
  argus and saifctl version independently. (e) is cleaner.

**Phase-4 path:** when VND-06 fires (upstream PR #75 merges + ships
binaries), `REPO` flips to `Meru143/argus` but the rest of path (e)
stays — runtime download from upstream's releases instead of ours.
The user-visible behavior is unchanged.

Touches: Q-03 (resolved → D-15), CLM-01 (✅, broader caveat closed),
VND-01 (✅), DCK-03 (partial ✅).

### D-17 — Saifdocs refactored into a compiler (Q-13 resolution; shipped 2026-05-04)

Saifdocs was refactored from an _orchestrator_ (which spawned
`saifctl sandbox` per-page via `src/generation/run-sandbox.ts:143`)
into a _compiler_. Each `saifdocs gen` invocation now emits one
timestamped saifctl feature tree under the consumer's
`saifctl/features/saifdocs-<ISO-8601-no-colons>/`, with
**N phases (one per file-to-generate)** and a `critics/audit.md`
documentation-review prompt. The user (or CI) runs `saifctl feat run
--feature <id>` afterwards to actually drive generation.

Concrete shape:

- ~1200 LOC deleted (`generate.ts`, `run-sandbox.ts`,
  `reference-gate.ts`, most of `review.ts`, `cli/sandbox.ts`,
  `review.cedar`, `review-strict.cedar`).
- ~340 LOC added in new `src/features/` (`compiler.ts`,
  `templates.ts`, `timestamp.ts`, `howto-hints.ts`).
- `saifdocs gen` and `saifdocs review` rewritten to emit a feature
  dir and exit; no subprocess spawn.
- `saifdocs update` rewritten to emit a feature tree containing only
  stale phases (uses the existing staleness rules).
- `@safe-ai-factory/saifctl` moved from `dependencies` →
  `devDependencies`. Saifdocs has zero runtime dependency on saifctl.
- Cedar policy is now policy-agnostic from saifdocs's side: the
  consumer repo decides per-feature policy via `feature.yml` /
  `--cedar`.

Phase-number width = `String(N).length` so 50 pages → `01..50`,
1023 pages → `0001..1023` — preserves lexicographic ordering at any
scale.

Verification (2026-05-04): 153/153 tests passing, lint/typecheck/build
clean.

Touches: VND-04 (architectural piece — done), §3.8 SDR-\* (publish-
readiness piece — pending), Q-13 (resolved), Q-12 (now resolvable as
D-18).

### D-18 — Saifdocs publishes independently of saifctl (Q-12 resolution)

After D-17, saifdocs has no runtime dependency on saifctl. The
publish-order chicken-and-egg is gone. **Decision:** saifdocs ships
on its own cadence, whenever ready. First public release planned at
`v0.1.0` (mirrors saifctl's D-01 alpha posture).

Practical consequences:

- Saifdocs's npm publish workflow doesn't need to wait for or
  coordinate with saifctl's.
- `vendor/saifdocs` migrates to its own org repo (SDR-08), then
  registers as a real submodule in saifctl's `.gitmodules` (SDR-09).
- The web docs source-of-truth question (Q-05) is no longer a
  publish-blocker for saifdocs.

Touches: SDR-01 (version bump), SDR-08 (org migration), SDR-09
(submodule registration), Q-12 (resolved).

### D-16 — `vendor/leash`: keep fork temporarily, transfer to org, rebuild image

Resolves VND-02 in the same shape D-14 did for argus, but smaller in
scope because the substantive fix is already merged upstream.

**Investigation findings:**

- Upstream PR [strongdm/leash#71](https://github.com/strongdm/leash/pull/71)
  was MERGED (commit `164015b`, 2026-04-06).
- **No upstream artifact yet ships the fix:**
  - npm `@strongdm/leash@1.1.7` (latest, 2026-03-11) → predates fix.
  - upstream tag `v1.1.7` (2026-03-04) → predates fix.
  - `public.ecr.aws/s5i7k8t3/strongdm/leash:v1.1.7` and `:latest`
    Docker images → predate fix.
- 28+ days since the commit landed without a tagged upstream
  release. Bottleneck is just the maintainer's release cadence —
  not a structural pipeline bug like argus had.
- Of our 3 fork commits, only `430a2f4` (the proxy fix) is
  upstreamable, and it already is. The other two (`6ca7cf9` adding
  `Dockerfile.h2patch`, `e5ed6b5` UI dist placeholder fix) are
  **fork-specific build infrastructure** for our patched image —
  not relevant upstream.

**Why this is small-scope vs argus's D-14:**

- No code PR needed (fix already merged).
- No release-pipeline bug to fix (release.yml runs successfully on
  every `v*.*.*` tag; the maintainer just hasn't tagged).
- Only mechanical work needed on our side: transfer + rebuild image
  at new namespace + flip refs.

**What got done (2026-05-04):**

1. **GitHub repo transfer** `JuroOravec/leash` → `safe-ai-factory/leash`
   (PRE-09 expanded scope).
2. **Docker image rebuilt + pushed** multi-arch at
   `ghcr.io/safe-ai-factory/leash:latest-h2patch` and the
   sha-pinned `:h2patch-e5ed6b5`. Layers cached from prior build,
   push completed in seconds. Required a new PAT with
   `write:packages` for the org since the keychain token only
   scoped to `JuroOravec`.
3. **saifctl-side updates:**
   - `.gitmodules` URL `JuroOravec/leash` → `safe-ai-factory/leash`,
     `git submodule sync` propagated.
   - `DEFAULT_LEASH_IMAGE` in `src/constants.ts:131` flipped to
     `ghcr.io/safe-ai-factory/leash:latest-h2patch`.
   - Comment block in `src/constants.ts` rewritten to reflect
     current state (PR merged but no tag yet, removal procedure on
     upstream tag release).
   - `vendor/README.md` swept (`JuroOravec/leash` → `safe-ai-factory/leash`,
     `ghcr.io/jurooravec/leash` → `ghcr.io/safe-ai-factory/leash`).
4. **Verified** the new image pulls cleanly + 759 saifctl tests
   pass.

**No upstream PR submitted.** Could optionally open an issue politely
asking when v1.1.8 will be cut — skipped for now since it's
low-leverage (the maintainer is presumably aware) and watching the
releases page is sufficient.

**Phase-4 deletion (➡️) when upstream cuts a tag containing `164015b`:**

1. Bump `@strongdm/leash: ^1.1.6` → the new version (or remove if
   unused).
2. Either flip `DEFAULT_LEASH_IMAGE` to
   `public.ecr.aws/s5i7k8t3/strongdm/leash:v<new>` or delete the
   constant + the `WORKAROUND(leash-http2)` block in
   `src/engines/docker/index.ts`.
3. `git submodule deinit vendor/leash && git rm vendor/leash`.
4. Drop the `[submodule "vendor/leash"]` block from `.gitmodules`.
5. Delete the leash section of `vendor/README.md`.
6. Optionally archive `safe-ai-factory/leash` repo + delete the
   GHCR image.

Touches: VND-02 (✅), PRE-09 (✅, scope expanded to include leash
transfer + GHCR rebuild).

### D-19 — Docker image publish: release-only trigger + multi-arch (DCK-01 resolution; shipped 2026-05-04)

Closes the DCK-01 deep-dive. Three sub-decisions bundled:

**Trigger model.** Image publish (and, by extension, npm publish — see
DCK-05) fires on `release: published` only, not on bare `push: tags`.
A `workflow_dispatch` input lets us republish a specific tag manually.

Why release-published over tag-push:

- A bare `git push --tags` mid-experiment shouldn't ship images to
  GHCR. Requiring an explicit Release adds a deliberate intent gate.
- It lets us cut RC tags (`v0.1.0-rc1`) for internal pinning without
  auto-publishing.
- Image publish is semantically a _release_ event, not a ref creation.
- Single trigger eliminates the prior double-fire (the workflow had
  both `release: published` and `push: tags: 'v*'`, so a `gh release
create` ran the whole pipeline twice).
- Downside (can't republish without creating a Release) is mitigated
  by the `workflow_dispatch` input.

**Multi-arch.** Both `linux/amd64` and `linux/arm64`, manifest-list
push via `docker buildx`. Maintainer is on M-series Mac and arm64
emulation on amd64 images is slow enough to be a real friction point
for any arm64-host user. CI cost is one-time per release; dev
ergonomics win.

**Implementation shape.** The buildx + push logic lives in
`scripts/docker.ts` behind four flags (`--push`, `--platforms`,
`--image-prefix`, `--extra-tag`). The workflow stays thin: it sets up
QEMU + buildx, calls the existing `pnpm docker build {test,coder}
--all` with the new flags, then runs two functional smoke tests
(`docker run … node --version`) against the default coder and test
images. This keeps the profile→tag→Dockerfile mapping in one place
(the script) and the workflow trivially easy to read.

**Stale-residue cleanup.** Pre-merge, the workflow had a `pnpm docker
build stage --all` step that referenced a `stage` subcommand the
script never defined. (Stage and coder envs were separate; they
merged into "coder" later.) The `saifctl-stage-` runtime container
naming in `src/engines/docker/index.ts` and `scripts/docker.ts:302`
remains live (it's the per-run staging container, unrelated to
build-time). Other `saifctl-stage-` mentions in `docs_old/` and
`web/x_design/` are already covered by NPM-18 (transplant) and
PRE-07 (human cleanup) respectively.

**Image inventory page.** New: `docs_old/docker-images.md`
(pending saifdocs transplant per NPM-18; auto-generated `docs/`
tree stays empty during migration), linked from README's Reference
section. Documents the registry path
(`ghcr.io/safe-ai-factory/saifctl/<image>:<tag>`), tag conventions
(`:latest` vs `:vX.Y.Z`), full per-family image list, multi-arch
pull semantics, pre-pull commands, override flags, and pointers to
the publish workflow.

Touches: DCK-01 (✅), DCK-05 (✅, paired trigger sweep on
`publish-npm.yml`), DCK-03 (since-resolved — sandbox image presence

- Leash daemon image registry probe both shipped under DCK-03's
  2026-05-04 deepening).

### D-20 — Fold saifbox into saifctl as "Sandbox mode"; surface dual positioning via L1 + N3

Resolves **Q-11**. The exploration found saifbox is literally
`saifctl sandbox` — every saifbox docs tutorial decodes to
`saifctl sandbox --agent <name>`. saifbox was a marketing wrapper
around an existing CLI subcommand, not a separate product. Deleting
the wrapper is a marketing/IA reorg, not a technical change.

**Naming (N3): "Sandbox" / "Factory".** Two reasons:

1. _Sandbox_ is the existing CLI verb (`saifctl sandbox`) + an
   established mental model in tooling (Docker sandboxes, browser
   sandboxes); zero teaching cost.
2. _Factory_ sits one level above _Gauntlet_. The Gauntlet (Gate +
   Reviewer + Holdout tests) is now a single layer inside a richer
   spec-driven flow that also includes phases + critics + subtasks.
   "Factory" names the _whole_ spec-driven behavior; "Gauntlet" is
   the inner mechanism inside Factory mode. Also echoes the parent
   brand "Safe AI Factory" without conflict — the parent brand is
   the org, the mode is the saifctl behavior.
3. Rejected: "Sandbox / Spec-driven" (too jargony for the entry
   surface); "Sandbox / Gauntlet" (Gauntlet is now too narrow).

**Layout (L1): single page, twin hero, sandbox CTA → docs.** The
`/saifctl` page leads with a 50/50 hero — Sandbox on one side,
Factory on the other. The Sandbox half is short (one pitch, one
command, CTA → relocated docs at `/saifctl/sandbox/`). The Factory
half is short too, but the rest of the page below the hero
continues the Factory narrative as currently. This avoids burying
the simpler entry tier (which is the risk in spec-led layouts) and
keeps the Factory page readable (which is the risk in fully twin
layouts where both stories compete for the page).

**Docs IA**: relocate `web/src/content/docs/saifbox/` →
`web/src/content/docs/saifctl/sandbox/`. Saifctl's docs gain a
`sandbox/` sub-tree alongside its existing concepts/how-tos/tutorials;
the sandbox CTA from the web page lands there.

**Inbound link preservation:** Next.js redirect at
`web/next.config.ts` from `/saifbox` → `/saifctl#sandbox` (or
`/saifctl/sandbox`).

**Audience-flag downstream:** saifdocs' fixtures currently treat
`saifbox` as a productId (`vendor/saifdocs/src/review/review-task-file.test.ts`

- `docspec/products/saifbox/...`). After D-20, "saifbox" becomes
  either an audience tag within saifdocs (a way to write
  "for-the-simpler-audience" docs without naming a separate product)
  or is removed entirely. Tracked as a saifdocs follow-up under D-17
  scope; doesn't block saifctl `v0.1`.

Touches: VND-03 (👍, scope is now WEB-08 implementation),
WEB-08 (new — multi-surface implementation: twin hero, page
deletion + redirect, nav/home/footer cleanup, docs.ts +
sync-docs.ts, content/docs relocation), NPM-21 (new — README "Two
modes" section), WEB-01 (saifbox nav.json slot drops out), WEB-05
(saifbox half resolved; saifdocs half still ⚠️), Q-11 (resolved),
Q-06 (saifbox half drops out), Q-05 (web docs source-of-truth
question simplifies — only saifdocs has the upstream-vs-local
choice now), PRE-08 (saifbox half resolves to "no registration
needed").

---

## 6. Open questions

These need user input before they can become decisions. Do not implement
items that depend on these without resolving the question first.
Numbering is stable — when a question becomes a decision, it migrates to
§5 with a `D-NN` id and the original `Q-NN` slot is marked **resolved →
D-NN**.

- **Q-01** → resolved as **D-01** (`v0.1.0` alpha first).
- **Q-02** → resolved as **D-02** (independent SemVer trains, CLI compat
  probe at activation).
- **Q-03** → resolved as **D-15** (path (e): runtime download + mount,
  current wired setup; user-visible disclosures from path (a) — README
  Requirements line + `saifctl doctor` HEAD-probe — already shipped per
  VND-01 / D-14).
- **Q-04** → resolved as **D-05** (drop 15 of 19 provider SDKs; keep
  Anthropic, Google, Google Vertex, OpenAI as native; route the rest
  through `@ai-sdk/openai` with `baseURL` overrides).
- **Q-05** — **Web docs source of truth.** `web/scripts/sync-docs.ts`
  pulls from `vendor/saifdocs` and `vendor/saifbox`. Make those upstream
  repos canonical, or make `safe-ai-factory/docs/` canonical and have
  the web site read from there?
- **Q-06** — **`safeaifactory.com` scope at launch.** Saifbox half is
  resolved by **D-20** (saifbox folds into saifctl, no separate page).
  Saifdocs half remains: ship the saifdocs product page at launch
  (risking skeletal copy), or hide it and ship saifctl-only? (See WEB-05
  saifdocs subtask.)
- **Q-07** → resolved as **D-06** (Cedar default policy stays
  unrestricted; threat model documented in `docs/security.md`).
- **Q-08** — **Windows support timing.** README says "Windows is not
  supported yet". Acceptable launch caveat, or target version for
  inclusion?
- **Q-09** — **Telemetry / phone-home defaults** (X-03). On by default
  with opt-out, off by default with opt-in, or none at all in the first
  release?
- **Q-10** → resolved as **D-03** (publish under `@safe-ai-factory`
  org).
- **Q-11** → resolved as **D-20** (fold saifbox into saifctl as
  "Sandbox mode"; investigation found saifbox is literally
  `saifctl sandbox`, so the fold is a marketing/IA reorg, not a
  technical change. L1 twin-hero on `/saifctl` page; sandbox CTA links
  to docs deep dive while the rest of the page stays focused on the
  Factory narrative).
- **Q-12** → resolved as **D-18** (independent publish timing — saifdocs
  publishes whenever ready; D-17's refactor severed the runtime saifctl
  dep so the previous "must ship after saifctl" gate is gone).
- **Q-13** → resolved as **D-17** (yes, refactor saifdocs into a
  compiler — refactor shipped 2026-05-04; saifdocs now emits a
  saifctl feature tree per `gen` invocation).
- **Q-13 (original full body, kept for cross-references)** —
  **`saifdocs` architectural decoupling: refactor saifdocs into a
  compiler that emits a `saifctl/features/` tree?**
  **Investigation conclusion (Appendix A.5): highly feasible.**
  Concrete sizing: ~1200 LOC deleted (`generate.ts` 396, `run-sandbox.ts`
  173, most of `review.ts` 207, gate-script wiring, both
  `review*.cedar` files), ~300 LOC new (`compileManifestToFeatureTree()`),
  ~2800 LOC unchanged (docspec parsing, manifest builder, audit,
  validate). Effort: 1-2 weeks.

  **Output shape (per user clarification).** Each saifdocs run emits
  **one timestamped feature dir** containing **N phases — one per
  file-to-generate**. So if a single saifdocs run produces 50 doc
  pages, the result is _one_ `saifctl/features/saifdocs-<timestamp>/`
  with 50 phases. The agent works through them in order, each in
  fresh LLM context, with cumulative tests across phases. Today's gen
  ordering (references → concepts → how-tos → tutorials →
  landing-pages) is preserved by lexicographic phase numbering inside
  the feature. **Phase-number width is computed from the total page
  count for that run** — leading zeros padded so ordering stays
  lexicographically correct regardless of count: 50 pages → `01..50`;
  1023 pages → `0001..1023`. (Width = `String(N).length`.) e.g. for a
  50-page run:

  ```
  saifctl/features/saifdocs-2026-05-04T10-30-45/
    feature.yml
    plan.md
    critics/
      audit.md          # persona-review prompt
    phases/
      01-ref-cli-flags/spec.md
      02-ref-config/spec.md
      …
      10-concept-auth/spec.md
      …
      20-howto-deploy/spec.md
      …
      50-landing-overview/spec.md
  ```

  Naming uses a fresh timestamp/UUID per saifdocs run by default so
  multiple runs accumulate side-by-side (e.g. monthly recurring
  documentation refresh, before-vs-after refactor snapshots, audit
  trails). Override available for stable IDs if the consumer wants
  in-place regeneration.

  **No saifdocs-shipped Cedar policy.** Today saifdocs ships
  `review.cedar` and `review-strict.cedar`; both are dropped in the
  refactor. The Cedar policy is decided by the consumer repo (the
  user invoking saifdocs against their docspec). They wire it via
  `feature.yml`/`--cedar` on their end. Saifdocs is policy-agnostic.

  Mapping today → post-refactor:
  - manifest entry → saifctl **phase** (one phase per file)
  - "gen phase" grouping (references → concepts → how-tos →
    tutorials → landing-pages) → preserved via lexicographic phase
    numbering inside a single feature
  - `saifdocs review` → critic with discover/fix split (`critics/audit.md`)
  - `saifdocs audit` (file-existence completeness check, no LLM)
    stays as pre/post-flight in saifdocs.

  Net effect: saifdocs's runtime dep on saifctl disappears (it stops
  `spawn`ing it; both can become dev-deps of each other for tests
  only). The contract becomes the feature-tree shape. Both can publish
  independently. Saifctl orchestration improvements automatically
  benefit saifdocs.

  Recommendation: **proceed with the refactor as a 1-2 week spike
  before the saifdocs publish.** Resolves Q-13 = yes, then Q-12
  collapses to "ship saifdocs whenever it's ready." Two concrete
  follow-ups for the spike (the cedar one was dropped per the
  policy-agnostic decision above):
  1. Build `compileManifestToFeatureTree()` that emits a single
     timestamped feature dir with one phase per manifest entry,
     against 2-3 example docspec inputs; confirm `saifctl feat run`
     discovers and runs the emitted phases in the right order.
  2. Decide the timestamp/ID format for default feature naming
     (`saifdocs-<ISO-8601-no-colons>` works on all filesystems, sorts
     lexicographically) plus an override flag for stable IDs in the
     occasional in-place-regen case.

  See VND-04 for the work-item; Appendix A.5 for the investigation
  provenance.

- **Q-14** → resolved as **D-13** (option (b): relocated to
  `vscode-ext/docs/cursor-vs-vscode-remote-containers.md`, single
  adjusted doc; raw JSON dumps dropped, regen instructions
  preserved).
- **Q-15** → resolved as **D-14** (path (d): keep fork temporarily,
  submit upstream PR fixing the actual root cause — `GITHUB_TOKEN`
  anti-recursion on bot-pushed tags — plus the trigger pattern
  alignment plus musl additions; deeper investigation showed the
  actual upstream bug is the token, not just the trigger).

---

## 7. Out of scope for the first cut

Captured here so they don't accidentally creep into a phase later.

- **Feature parity with proprietary tools** (Devin, Factory, Cursor
  Background Agents). saifctl's wedge is the safety harness + spec
  loop; not bolting on every agentic UX.
- **A custom IDE** — only the VS Code extension is in scope.
- **Killing `dangerousNoLeash`** — stays as an opt-in for debug/dev.
- **Vendoring argus _source code_ into saifctl's tree.** Distinct from
  shipping a _built argus binary_ with saifctl's coder Docker image,
  which is on the table as Q-03 path-(d) — surfaced by D-08 when
  reviewing `vendor/`. Argus stays its own product with its own repo;
  what we ship in our coder image (binary, not source) is open.
- **Re-architecting the orchestrator loop** — X-09 (former NPM-08) is
  "extract a context object", not "rewrite the loop". The loop's
  behavior is sound.
- **A web app for run management** — VS Code extension is the official
  UI surface. The web site is marketing + docs, not a control plane.

---

## 8. Prerequisites — moved to §3.0.1

Section content relocated to **§3.0.1** on 2026-05-07. Phases assume
their blocking PREs are ✅ before they start, so the table belongs
up-front next to the at-a-glance summary, not buried after Open
questions and Out-of-scope. PRE-01..PRE-12 IDs unchanged. This stub
stays as a navigation aid for legacy cross-references.


---

## 9. Suggested phase breakdown (preliminary)

Working hypothesis. To be refined once §5 decisions land. Numbering is
lexicographic-friendly so we can `mkdir phases/01-…` without renaming
later. Severity counts in parentheses are items currently parked in the
phase.

1. **`01-publish-blockers`** — the cheap-but-mandatory cleanup that
   makes the artifacts publishable. NPM-01, NPM-02, NPM-04 (Node 22),
   NPM-09 (gitignore `dist-pack/`), NPM-12 (clean up stale saifdocs
   comment; keep export), NPM-13, NPM-15, NPM-16, NPM-17 (tombstones
   README + `.npmignore`), VSX-01, VSX-02, VSX-03, VSX-05, VSX-06,
   VSX-09.
   _(15 items, mostly B+🟠)_
   Goal: `npm publish --dry-run` and `vsce package` produce clean
   artifacts published under the `@safe-ai-factory` org at `v0.1.0`,
   targeting Node 22 LTS; the published tarball has no accidental
   garbage.

2. **`02-marketing-truth`** — README + web copy + docs accurately reflect
   what ships. CLM-01 (Q-03 dependent), CLM-02, CLM-03, CLM-04, CLM-05,
   CLM-06, CLM-07, DOC-05, WEB-03, NPM-05 (fill in the three README TODOs
   — depends on DOC-08 from phase 03 and VSX publish from phase 05).
   _(10 items, mostly I)_
   Goal: a skeptical reader can't catch us in an overclaim. Hatchet
   moves to "Coming soon"; reviewer claim aligns with Q-03's resolution;
   no live `<!-- TODO -->` markers in the README.

3. **`03-docs-base`** — the minimum docs surface for first launch.
   DOC-01, DOC-02, DOC-03 (CONTRIBUTING; absorbs NPM-14's publish-flow
   write-up), DOC-04, DOC-05, DOC-06, DOC-08 (write
   `docs/spec-driven-development.md`), DCK-02 (D-06 threat-model
   write-up), NPM-18 (transplant `docs_old/` concepts into `saifdocs`,
   then delete).
   _(9 items, B+I)_
   Goal: every CLI command has a reference page; `SECURITY.md` +
   `docs/security.md` + `docs/leash-access-control.md` +
   `docs/spec-driven-development.md` are real; CONTRIBUTING documents
   both publish flows; docs/ contains everything README references;
   `docs_old/` is empty / removed with conceptual coverage proof.

4. **`04-web-launch`** — the website is deployable and clean. WEB-01,
   WEB-02, WEB-04, WEB-05, WEB-06, WEB-07.
   _(6 items, B+I)_
   Goal: `safeaifactory.com` deploys from CI green-path with no manual
   steps and no `[placeholder]` strings.

5. **`05-vscode-marketplace`** — extension is publishable. VSX-04,
   VSX-07, VSX-08, VSX-10, VSX-11.
   _(5 items, mostly I)_
   Goal: `vsce publish --dry-run` is clean, smoke test passes against a
   real workspace, activation-time CLI compat probe works on
   matched/mismatched/missing-CLI scenarios.

6. **`06-test-harness-and-coverage`** — net-new test infrastructure.
   X-08 (the integration harness — Docker + container + agent + hard-coded
   provider) and its sub-phase X-08-P4 (raise threshold to 70% on
   critical paths; former NPM-07), X-01 (smoke matrix riding on the
   harness), X-04 (provider invocation tests on the four kept native
   paths).
   _(4 items, B+I)_
   Goal: a single command spins a container, runs an agent against a
   real LLM (provider hard-coded), and asserts on the resulting working
   tree; coverage on orchestrator / CLI / sandbox engine is ≥70%; CI's
   nightly job runs the smoke matrix; per-PR tests mock the LLM at
   `LanguageModelV3`.

7. **`07-doctor-deepening`** — `saifctl doctor` becomes a real preflight.
   ✅ **Phase complete (2026-05-04).** All items shipped: DCK-03 (Leash
   daemon image, default coder/test image presence, Cedar structural
   lint, LLM env-var presence — see the row for v0.1 vs v1.0 split),
   NPM-03 (Hatchet 3-state per D-04), CLM-01 path-(a) (argus endpoint
   HEAD probe per D-15). Real Cedar parse validation and live LLM
   API-call probe deferred to v1.0.
   _(0 open items)_
   Goal achieved: green `doctor` correlates with green `feat run`.

8. **`08-deps-and-vendor`** — the package gets healthier on disk +
   resolves the vendor/ taxonomy. NPM-06 (D-05 refactor: drop 15 provider
   deps, route via OpenAI-compat), VND-01 follow-ups (doctor probe of
   argus download endpoint per DCK-03; README disclosure of the
   network-fetch dependency per CLM-01), VND-02 follow-up (decide
   whether to add fork-CI workflow that auto-builds the h2patch image
   instead of maintainer-machine), VND-03 (saifbox keep-or-fold per
   Q-11 resolution), VND-04 (saifdocs decisions per Q-12 + Q-13),
   VND-05 (relocate dev-containers-manifests per Q-14).
   _(7 items, ⚠️-heavy until Q-11..Q-14 resolve)_
   Goal: clean install has only the 4 native `@ai-sdk/*` packages from
   D-05; every entry under `vendor/` has an explicit "ship from
   upstream / build ourselves / bundle binary / runtime download"
   decision recorded; `vendor/dev-containers-manifests/` is relocated;
   saifbox + saifdocs scope is locked.

9. **`09-cost-visibility`** — basic spend/token surfacing for alpha
   users. X-02.
   _(1 item)_
   Goal: `saifctl run get` shows total tokens and a $-estimate per
   run, so an alpha user running overnight loops sees what they spent.
   Deeper telemetry (OTel/Sentry, X-03) is deferred to v1.

10. **`11-v1-deferred`** — explicit holding pen for v1.0 items, marked
    ➡️ in §3 and §4. NPM-03 (real Hatchet+resume fix; D-04 only gates
    the error message), X-09 (orchestrator state refactor; former
    NPM-08), DOC-10 (housekeeping for author-internal repo files;
    former NPM-10), X-10 (98% coverage uplift; former NPM-20), X-03
    (OTel/Sentry export), X-05 (indexer packaging unification), X-06
    (Helm chart), X-07 (`saifctl validate` linter), VND-06 (Phase 4
    — migrate saifctl back to consume upstream argus once the upstream
    PR merges and a tagged release ships binaries).
    _(9 items)_
    Goal: documented, scheduled; not blocking the v0.1 launch. Each
    item gets a one-line note in CHANGELOG's "Unreleased / v1" section.

Phases 01–06 form the **v0.1 launch path**. Phases 07–09 form the
**alpha hardening cycle** (still 0.1.x line). Phase 11 is the v1.0
backlog. The previous "phase 10 orchestrator-cleanup" is dropped — its
items X-08-P4 (former NPM-07; `v0.1`-scoped at 70% in phase 06) and
X-09 (former NPM-08; ➡️ in phase 11) split apart per Decision D-07.

---

## Appendix A — Audit / investigation provenance

The findings in §3 derive from four parallel audits run during the
readiness conversation, plus targeted re-investigations triggered by
specific questions:

- **A.1 Cleanliness audit** — npm package + extension + web/docs
  polish.
- **A.2 Spec-driven loop audit** — feat workflow, convergence loop,
  run lifecycle, profiles, semantic reviewer, init flow.
- **A.3 Sandbox & security audit** — Docker isolation, Cedar/Leash
  enforcement, secrets, network, doctor, command injection.
- **A.4 Integrations audit** — LLM providers, agentic CLIs, languages,
  git providers, MCP, Hatchet, Mastra, S3.
- **A.5 saifdocs deep dive** (triggered by Q-13). Walked
  `vendor/saifdocs/src/{cli,docspec,manifest,generation,review,audit,validate}/`
  to assess refactor feasibility — could saifdocs become a _compiler_
  that emits a saifctl feature tree, with `saifctl feat run` as the
  orchestration engine? Findings: today saifdocs spawns `saifctl
sandbox` per-page (`src/generation/run-sandbox.ts:143`) with its
  own subtask-builder and persona-review subsystems; ~3956 production
  LOC total. Refactor would delete ~1200 (generate.ts, run-sandbox.ts,
  most of review.ts, both `review*.cedar` files), add ~300
  (`compileManifestToFeatureTree()`), and leave ~2800 unchanged
  (docspec parsing, manifest, audit, validate). Concept mapping
  _(refined per user clarification)_: each saifdocs run emits **one
  timestamped feature** with **N phases (one per file-to-generate)**
  — the agent gets full focus per file, with cumulative tests across
  phases preserving today's gen ordering (refs → concepts → how-tos
  → tutorials → landing-pages, encoded via lexicographic phase
  numbers). Default dir name is `saifdocs-<ISO-8601-no-colons>` so
  multiple runs accumulate (monthly recurring cleanup, before/after
  snapshots). saifdocs ships _no Cedar policy_; the consumer repo
  decides per-feature policy. Review subsystem maps to a critic with
  discover/fix split; audit (file existence) stays in saifdocs as
  pre/post-flight. Recommendation: proceed as 1-2 week spike before
  saifdocs publish. Surfaces two follow-ups (compiler against 2-3
  example inputs; timestamp/ID format with override-for-stable-IDs).
  Updates Q-12 (publish timing) + Q-13 (decoupling).
- **A.6 Vendor forks investigation** (triggered by NPM-19 split into
  VND-01..VND-05 and Q-15). Walked `vendor/argus/`, `vendor/leash/`,
  `vendor/saifbox/`, `vendor/saifdocs/`, `vendor/dev-containers-manifests/`
  to determine: divergence vs upstream, upstream PR status, whether
  upstream releases binaries, whether we build/publish from fork CI,
  and saifctl's actual consumption pattern. Findings folded into
  VND-01..VND-05 row text and into Q-15's argus options.

Each audit produced a structured report; this spec consolidates and
de-duplicates their findings. When in doubt about an item's source or
severity, the audit reports are the trail.

## Appendix B — What the audits found that is NOT in scope here

For completeness — items the audits surfaced as **already working
well** and which therefore do not appear in §3:

- The sandbox really is the boundary (containers, mounts, lifecycle).
- Cedar/Leash is mandatory by default and policies are non-trivial.
- Spawn is injection-proof (array args, `--` separators, image-tag
  regex).
- Secrets pass through redaction layers before any logging.
- Git-patch extraction/application is safe (`.git` writes are Cedar-
  forbidden, preventing host-hook escape).
- All 14 run-lifecycle commands are implemented (only Hatchet+resume
  throws — see NPM-03).
- All four claimed languages are wired end-to-end (sandbox + tests +
  validation gates).
- All five major git providers have real REST API integrations and
  unit tests.
- Profiles are populated, not empty: 15 agent, 28 sandbox, 8 test.
- Multi-phase feature execution and the critic layer have shipped on
  `main` and integrate with the orchestrator loop.

These are the load-bearing parts of the product. The release work is
about closing the gaps around them, not rebuilding them.

## Appendix C — ID conventions and citations

Reference for the IDs used throughout this spec (`NPM-07`, `D-04`,
`X-08-P2`, etc.). Rules apply **within this feature only** — sibling
features under `saifctl/features/` use their own conventions and may
reuse the same prefixes without coordination, which is why §C.3
(citation form) matters.

### C.1 ID format

**Work-item IDs:** `<COMPONENT>-<NN>`

- Component prefix: 3+ uppercase letters, recognisable, mnemonic for
  the component group it belongs to. Existing prefixes registered in
  this spec:

  | Prefix | Component                                        |
  | ------ | ------------------------------------------------ |
  | `CLM`  | README claims (marketing-vs-reality)             |
  | `DCK`  | Docker / image publish                           |
  | `DOC`  | Documentation                                    |
  | `NPM`  | npm package & publish                            |
  | `PRE`  | Prerequisites (human-only, see §3.0.1)           |
  | `SDR`  | Saifdocs publish readiness                       |
  | `VND`  | Vendor / `vendor/*` subdirectories               |
  | `VSX`  | VS Code extension                                |
  | `WEB`  | Web (`web/`)                                     |
  | `X`    | Cross-cutting (single-letter — historical, kept) |

  When adding a new prefix, grep first to confirm it is not already
  in use:

  ```bash
  rg '\b<PROPOSED>-' safe-ai-factory/saifctl/features/release-readiness/specification.md
  ```

- Number: 2 digits, leading zero (`01`, …, `99`). Numbering is the
  order rows were created — not severity, not priority.

**Sub-IDs** (when a single work item is decomposed into phases):

`<PARENT>-P<NN>`. Example: the X-08 integration-test harness has
sub-phases `X-08-P1` through `X-08-P8`. Same dash convention as the
parent — no special-cased shapes (an earlier draft used the form
`X-08-P<N>` without the inner dash; that form is deprecated and is
being migrated to `X-08-P<N>`).

**Decision IDs:** `D-NN`, leading zero. Decisions migrate up from §6
(Open questions) into §5 (Decisions) when the user makes a call.

**Open-question IDs:** `Q-NN`, leading zero. When resolved, the §6
slot is rewritten to `Q-NN → resolved as D-NN` with a one-line summary;
the slot itself is **not deleted or renumbered**, so cross-references
in chat history don't rot.

**Prerequisite IDs:** `PRE-NN`, leading zero. Live in §3.0.1
(historical home: §8; relocated 2026-05-07).

**Stable forever.** No ID is ever reused, renumbered, or deleted.
New work appends at the end of the relevant table. This is the rule
that makes every cross-reference in chat history, in **Touches:**
lines, and in code comments still valid six months later.

### C.2 Authoring rules

- **Each affected row references its decision.** When a decision
  resolves a row, edit the row text to include `**Decision D-NN.**`
  inline. The spec stays self-explanatory — readers don't have to
  jump to §5 to understand a row.
- **Each decision carries a Touches: line.** Lists the work-item IDs
  it affects, comma-separated. When the user asks _"what does D-04
  affect?"_, the answer is one line away.
- **Status & severity legend is in §3.** Don't re-define the symbols
  (`B/I/N`, `⚠️/👍/🟠/➡️/✅`) elsewhere; link to §3 if needed.
- **Sub-IDs append, like top-level IDs.** `X-08-P9` is a legitimate
  add; never reuse a retired sub-ID.

### C.3 Citing an ID from outside the spec

When referencing an ID from anywhere else in the repo (code comments,
internal docs, commit messages), use the **qualified form**:

```
release-readiness/<ID>
```

Examples:

- `// (per release-readiness/D-07): scope LLM calls to the weekly job.`
- `* See release-readiness/X-08-P2 for the dummy-feature scenario.`
- `# Drop-privileges scaffold (release-readiness/X-08-P2)`

Why qualified: bare `D-07` looks identical to a future sibling
feature's `D-07`. The `release-readiness/` prefix matches the path
under `saifctl/features/`, so a reader can `cd` straight there. It
is also greppable — `rg 'release-readiness/'` returns every external
citation regardless of which ID type.

The single exception: **inside this spec file itself**, IDs may appear
bare (`see D-04`, `tracked under NPM-07`). The qualifier is implicit
from the file you are reading.

### C.4 Surface-exposure rules

IDs are **internal-tooling identifiers, not public API**. They must
not appear on user-facing surfaces.

**Forbidden surfaces:**

- CLI errors, help text, or any user-facing log output.
- End-user documentation: `web/`, `docs/`, top-level `README.md`,
  `CHANGELOG.md` user-visible body, `vscode-ext/README.md`.
- Exported type, function, or constant names.
- Public package metadata (`package.json` descriptions, marketplace
  listings).

**Allowed surfaces:**

- Code comments (the bulk of in-repo references).
- Internal-only docs: this spec, `SKILL.md`, `npm-tombstones/README.md`,
  similar maintainer-facing files.
- Commit messages, PR descriptions, branch names.
- Test names (`describe(...)`, `it(...)` strings) — visible only to
  people running the suite, which is the same audience as code
  comments.
- `CHANGELOG.md` per-entry footers / linkbacks (fine; entry **bodies**
  should read for end users).

### C.5 Validation

`pnpm check` runs [`src/validation/validate/id-references.ts`](../../../src/validation/validate/id-references.ts)
which fails the build if it finds:

- Bare `<PREFIX>-NN` references (matching this spec's prefixes) outside
  this spec, in surfaces that require qualification — without the
  `release-readiness/` qualifier.
- Deprecated `X-08-P<N>` form (without the inner dash).
- ID references on a forbidden surface (per §C.4).

When the validation rule fires, fix the citation rather than disabling
the rule. If a legitimate use case turns up that the rule mis-flags,
edit the rule's allowlist with a one-line comment explaining why.
