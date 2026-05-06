# Your first saifctl sandbox run

By the end of this tutorial you will have run OpenClaw inside a Docker sandbox, watched it work on a copy of your project, and understood exactly why your host files stay untouched. No prior knowledge of saifctl's Factory mode required.

## What you need

- Docker installed and running (Desktop on macOS/Windows, Engine on Linux)
- `saifctl` installed — confirm with `saifctl --version`
- A git repository to work in (any project works; we use a sample task below)

## Step 1: Check your environment

Run `saifctl doctor` to verify everything is in place before you touch your project:

```bash
saifctl doctor
```

It prints a pass/fail for each dependency. If anything fails, see [Troubleshoot saifctl setup issues](../how-tos/troubleshoot.md) and fix it before continuing.

## Step 2: Run OpenClaw in the sandbox

From your project root, run:

```bash
saifctl sandbox --agent openhands --task "Add a one-line comment to every public function in src/"
```

> `openhands` is the agent profile for OpenClaw. It is also the default, so `--agent openhands` can be omitted if you prefer.

saifctl will:

1. Spin up a fresh Docker container.
2. Copy your committed workspace files into that container.
3. Start openclaw inside the container with the task you provided.
4. Show the agent's output in your terminal.
5. Destroy the container when the task finishes.

While the agent runs, your host project files are not touched. The agent is writing to a copy.

> **Only committed files are copied by default.** Uncommitted edits and untracked files stay on the host. If the agent needs to see in-progress work, add `--include-dirty` to the command above.

## Step 3: Notice that your host is unchanged

When the run finishes, check your working tree:

```bash
git status
git diff
```

Nothing has changed. This is the core guarantee: **the agent works on a copy inside the container; the host is untouched by default.**

Here is why. When saifctl starts, it copies your committed files into the container. Cedar policies, enforced at the kernel level by the Leash binary, prevent the container from writing back to your host filesystem, spawning unexpected processes, or making unauthorized network calls. The container is disposable — think of it as a sandpit you can tip upside down and throw away. Nothing in it affects the real ground.

## Step 4: Apply the changes when you are ready (optional)

If the run looked good and you want to bring the agent's changes back to your host, re-run the command with `--extract`:

```bash
saifctl sandbox --agent openhands --task "Add a one-line comment to every public function in src/" --extract
```

saifctl takes the agent's `git diff` from inside the container and applies it to your host working tree via `git apply`. Review the result before committing anything:

```bash
git diff
git status
```

Nothing is committed automatically. You decide what goes into version control.

For filtering by path — including or excluding specific directories — see [Apply OpenClaw output to your project](../how-tos/apply-agent-changes.md).

For the full reference on all sandbox flags, see [Run OpenClaw safely with saifctl sandbox](../how-tos/run-agent-safely.md).

## What you have learned

- `saifctl sandbox` runs openclaw (or any supported agent) in an ephemeral Docker container.
- The agent reads and writes a **copy** of your workspace inside the container. Your host files are not modified.
- Cedar policies via Leash enforce the boundary at the kernel level — filesystem, process, and network are all constrained.
- Passing `--extract` is the only way to move changes back to your host; it is always opt-in.
- Both `saifctl sandbox` and `saifctl feat run` share this same container kernel — the difference is that Factory mode adds a gauntlet of gates and tests the agent must pass.

## Next step

Now that you can run OpenClaw safely, the natural next question is how to make it implement a feature end-to-end and verify the result automatically. Read [Run your first feature with saifctl feat run](../how-tos/run-first-feature.md) to see how the Factory mode works.
