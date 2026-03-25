# Fix agent mistakes with inspect and resume

Step into the agent's container, edit the code, and resume the run with the agent.

**You need:** Docker, [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) (VS Code), and a **Run ID**.

## When to use

- Fix a bug or wrong edit that AI agent made.
- Agent is stuck repeating the same failure.
- Review progress the agent made.

## Before you start

- **Run id** — First column of `saifac run list`, or the id printed when a run stops.
- **Same git repo** as the original run; base commit must still exist ([run resume notes](../commands/run-resume.md#notes)).
- **Saved runs enabled** — not `runs=none` ([Runs](../runs.md)).

Running `saifac run list` will show you the list of runs:

```bash
saifac run list

3 run(s):

  RUN_ID   FEATURE      STATUS     STARTED                   UPDATED                 
  eed5lz6  add-login    completed  2026-03-24T23:55:15.955Z  2026-03-25T11:10:35.904Z
  07l9q00  create-user  completed  2026-03-24T23:41:39.378Z  2026-03-24T23:45:50.384Z
```

Run ID is also included in the output of `feat run` and `run resume`:

```bash
saifac feat run -n add-login

...

Feature implemented successfully in 1 attempt(s).
Resume again with:
  saifac run resume eed5lz6
```

## 1. Start inspect

```bash
saifac run inspect <runId>
```

Keep this terminal open. Note the **container name** and **workspace path** from the logs.

```bash
[inspect] Attach your editor with Dev Containers or docker exec -it:
  Container: leash-target-sandboxes-safe-ai-factory-dummy-gtkcx8g
  Workspace: /workspace
[inspect] Press Ctrl+C when done to save changes and clean up.
```

<!-- > # TODO - ADD GIF. command → ready message. -->

## 2. Attach the editor

**Dev Containers (preferred):** Command Palette → **Attach to Running Container** → pick the name from step 1. Cursor uses the same idea under a slightly different menu label.

**Shell only:** `docker exec -it <container-name> bash` — fine for small edits; awkward for many files.

Via VSCode command palette:

![Attach to Running Container](./assets/inspect-and-resume--palette.png)

![Select container](./assets/inspect-and-resume--palette-select-container.png)

Via Dev Containers extension:

![Dev Containers list](./assets/inspect-and-resume--dev-containers.png)

## 3. Open the workspace folder

In the attached window: **File → Open Folder** → path from the CLI

By default, the workspace path is `/workspace`.

Now you're in the agent's sandbox. This is a **copy** of your host repo.

![Workspace folder](./assets/inspect-and-resume--explorer.png)

## 4. Make edit, run checks

Change files; run tests or installs **inside the container** if you want a quick check.

![Make edit, run checks](./assets/inspect-and-resume--edit.png)

## 5. Git history

The container's git history contains the entire history of the agent's actions.

Each agent loop and each `run inspect` creates a new commit in the container's git history.

You may create additional commits with `git commit`.

Each container has a "Base state" commit. This is the copy of your host repo at the start of the run.

```bash
git log --oneline

d7472ff (HEAD -> main) saifac: coding attempt 3
4652af6 saifac: coding attempt 2
71f52d3 fix(Juro): unblock agent
959ba1e saifac: coding attempt 1
ef903a9 Base state
```

Explore diffs in the UI:

![Git history](./assets/inspect-and-resume--git-history.png)

## 6. Stop inspect

In the **inspect** terminal: **Ctrl+C**. Saifac saves any changes you made to the run as a new commit.

Cleanup message:

```bash
^C
[inspect] SIGINT received — stopping session and cleaning up Docker (this may take a few seconds)...
[inspect] Saved updated run patch steps to storage.
```

<!-- # TODO ADD GIF ~20s: Ctrl+C through cleanup. -->

## 7. Resume

Resume the run with the same ID from step 1. See [`run resume`](../commands/run-resume.md) for more details.

```bash
saifac run resume <runId>
```

The agent's container will now include your changes from step 4.

Your agent should now successfully implement the feature:

```bash
saifac run resume eed5lz6 

[orchestrator] MODE: resume — dummy (run eed5lz6)
[orchestrator] Preparing workspace from storage...
Preparing worktree (new branch 'saifac-resume-eed5lz6')
HEAD is now at 7b5d1c6 refactor: rename `run inspect` to `run info`

...

Feature implemented successfully in 1 attempt(s).
Resume again with:
  saifac run resume eed5lz6
```

## If something goes wrong

| Issue | What to do |
| ----- | ---------- |
| `.saifac-inspect-stale-<runId>.json` file | Something else updated that run while you were in inspect; your changes landed in that file. Follow the CLI text; details in [run inspect](../commands/run-inspect.md#what-it-does). |


## Recap

`run list` → Run ID → `run inspect` → attach → open folder → edit → **Ctrl+C** → `run resume`

## Notes

- Enable Leash during `inspect` - **`run inspect`** uses **plain Docker** so you can **`git commit`** and use other tools policy may block.

   If you need to reproduce agent policy behavior, use **`--leash`**.

## See also

- [`run inspect`](../commands/run-inspect.md) · [`run resume`](../commands/run-resume.md) · [`run test`](../commands/run-test.md)  
- [Runs](../runs.md) · [Usage](../usage.md) · [Troubleshooting](../troubleshooting.md)
