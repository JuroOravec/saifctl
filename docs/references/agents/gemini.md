# Gemini agent

Run [Gemini CLI](https://github.com/google-gemini/gemini-cli) — Google's terminal agent — as the saifctl coder.

```bash
saifctl feat run --agent gemini
```

## Authentication

| Variable         | Purpose                                         |
| ---------------- | ----------------------------------------------- |
| `GEMINI_API_KEY` | Gemini API key (preferred)                      |
| `LLM_API_KEY`    | Generic fallback when `GEMINI_API_KEY` is unset |

`LLM_BASE_URL` is **not** forwarded — Gemini CLI has no base URL override.

## Model selection

The model is controlled by `LLM_MODEL_ID` (bare model id, e.g. `gemini-2.5-pro`). It is passed to Gemini CLI as `--model "$LLM_MODEL_ID"`. Use `LLM_MODEL_ID`, not `LLM_MODEL` — Gemini rejects the `provider/model` prefix form used by LiteLLM-style agents.

## How the prompt is passed

The task is read from `$SAIFCTL_TASK_PATH` and passed as a **positional argument** to `gemini`:

```bash
gemini --model "$LLM_MODEL_ID" --yolo --output-format stream-json "$(cat "$SAIFCTL_TASK_PATH")"
```

> **Note:** `-p` is **deprecated** in Gemini CLI and means `--profile`, not `--prompt`. Always use the positional argument.

## Flags used by the agent script

| Flag              | Value           | Purpose                                                            |
| ----------------- | --------------- | ------------------------------------------------------------------ |
| `<prompt>`        | task text       | Runs Gemini non-interactively                                      |
| `--model`         | `$LLM_MODEL_ID` | Override the model for the session                                 |
| `--yolo`          | —               | Auto-approve all tool calls; required for headless use             |
| `--output-format` | `stream-json`   | Newline-delimited JSON events; compatible with saifctl log parsing |

## Installation

Gemini CLI is pre-installed in the Leash coder image. If you supply a custom `--coder-image`, install it yourself (requires `npm` in the image):

```bash
npm install -g @google/gemini-cli
```

The agent script adds `$SAIFCTL_UNPRIV_NPM_PREFIX/bin` and `$HOME/.local/bin` to `PATH`, so a user-scoped npm install works without root.

## Example

```bash
GEMINI_API_KEY=your-key LLM_MODEL_ID=gemini-2.5-pro saifctl feat run --agent gemini
```
