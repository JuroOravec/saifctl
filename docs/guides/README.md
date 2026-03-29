# Guides

Step-by-step walkthroughs for using SaifCTL day to day. These complement the [command reference](../commands/README.md) and the pipeline overview in [Usage](../usage.md).

## Runs and shipping

| Guide | Use it when… |
| ----- | ------------ |
| [Run lifecycle: feat run → pause → resume → test → apply](run-lifecycle.md) | You want a single cheatsheet of **Run** commands: start work, pause/resume, verify, apply. |

## When things go wrong

| Guide | Use it when… |
| ----- | ------------ |
| [Fix agent mistakes: inspect, then run start](inspect-and-start.md) | The coding agent is wrong, stuck on an error, or you need to patch the sandbox by hand and then let the agent continue with `run start`. |
| [Live user feedback to the agent](providing-user-feedback.md) | Steer via **run rules** — Instructions appear in the task prompt. |

## Reference links

- [Usage](../usage.md) — Full pipeline diagram and stages
- [Runs](../runs.md) — What gets saved, storage backends, resume overview
- [Commands](../commands/README.md) — All CLI subcommands
