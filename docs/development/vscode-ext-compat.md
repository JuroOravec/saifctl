# VS Code vs Cursor: extension compatibility (Dev Containers attach)

This document explains a real compatibility gap between **Visual Studio Code** and **Cursor** when an extension invokes **Dev Containers** to attach to a running Docker container. It also describes **reproducible steps** to compare Microsoft’s extension manifests and **runtime behavior** against Cursor’s fork.

**Implementation in this repo:** `vscode-ext/src/inspectAttach.ts` (`attachToRunningDevContainer`, `attachToRunningContainerCommandArg`).

**Local-only artifacts:** The steps below use directories under **`vendor/`** (e.g. `vendor/dev-containers-manifests/`, `vendor/cursor-remote-containers/`). Those paths are **not** assumed to exist in a fresh clone and are **not** committed to git in this project. Run the **bootstrap** subsection first whenever you want manifests or Cursor’s bundle on disk for diffing or reading `dist/main.js`.

---

## 0. Bootstrap `vendor/` (do this first)

From the **`safe-ai-factory`** repo root (adjust `cd` if your layout differs):

```bash
cd /path/to/safe-ai-factory
mkdir -p vendor/dev-containers-manifests vendor/cursor-remote-containers
```

You will populate:

| Path | Contents |
|------|----------|
| `vendor/dev-containers-manifests/` | Microsoft `package.json` from the official VSIX, optional trimmed `*.contributes.json`, optional notes you write yourself |
| `vendor/cursor-remote-containers/<folder>/` | Full copy of Cursor’s installed extension (e.g. `anysphere.remote-containers-1.0.32/`) |

Add `vendor/` to `.gitignore` if it is not already ignored, so these trees stay local.

The rest of this document uses **environment variables** so you are not tied to a specific Microsoft or Cursor version:

```bash
# After you download Microsoft’s package.json (see §5.1), set:
export MS_PKG="vendor/dev-containers-manifests/ms-remote-containers-<VERSION>.package.json"

# After you copy Cursor’s extension folder (see §5.2), set:
export CURSOR_EXT="vendor/cursor-remote-containers/anysphere.remote-containers-<VERSION>"
export CR_PKG="$CURSOR_EXT/package.json"
export CR_MAIN="$CURSOR_EXT/dist/main.js"
```

---

## 1. What we were trying to do

The SaifCTL VS Code extension waits until `saifctl run inspect` exposes an inspect session (container name/id, workspace path), then opens a **new window** attached to that container—similar to **Remote Explorer → Dev Containers → Attach in new window**.

That can be done without private tree-item types by calling:

```ts
vscode.commands.executeCommand('remote-containers.attachToRunningContainer', /* argument varies by host app */)
```

and/or falling back to `vscode.openFolder` / `vscode.newWindow` with a `vscode-remote://attached-container+…` URI (see below).

---

## 2. Symptom: works in VS Code, fails in Cursor

- **VS Code** (Microsoft Dev Containers): attach succeeded when passing a **string** container name or id.
- **Cursor** (Anysphere Dev Containers): same call produced a toast like **“No container id found”** (and logged a viewlet-format error).

The command id is the same namespace (`remote-containers.*`); the **argument contract** differs.

---

## 3. Root cause: different handlers for the same command

Both products ship a **fork** of Dev Containers under the same conceptual API:

| Aspect | Microsoft (`ms-vscode-remote.remote-containers`) | Cursor (`anysphere.remote-containers`) |
|--------|---------------------------------------------------|----------------------------------------|
| **Handler** | `attachToRunningContainer` and `attachToRunningContainerFromViewlet` share one function that accepts **`typeof arg === 'string'`** **or** a tree item with **`containerDesc.Id`**. | The same two commands register the **same** async handler. If **`arg != null`**, it assumes a **viewlet** payload and requires **`arg.containerId`** to be a **string**. A **plain string** has no `.containerId` → error. |
| **No argument** | Shows a quick pick of running containers. | Same: **`docker ps`** quick pick. |

So **`executeCommand('remote-containers.attachToRunningContainer', 'my-container')`** is valid on **VS Code** and **invalid on Cursor**.

**Cursor-safe programmatic call** (name or id both work with Docker inspect):

```ts
vscode.commands.executeCommand('remote-containers.attachToRunningContainer', {
  containerId: ref,
});
```

**Detection in our code:** `vscode.env.appName` contains `"cursor"` and/or `vscode.env.uriScheme === 'cursor'`. See `attachToRunningContainerCommandArg` in `inspectAttach.ts`.

### 3.1 Why VS Code opens `/workspace` (or your `workspacePath`) but Cursor often does not — **without** changing SaifCTL’s branch order

This is **separate** from the argument-shape bug above.

**Symptom:** With `attachToRunningDevContainer` in the intended order (**branch 1** = `remote-containers.attachToRunningContainer`, then **branch 2** = `vscode.openFolder` with SaifCTL’s `vscode-remote://attached-container+…/session.workspacePath`, etc.), **VS Code** opens the remote window **with** the expected folder (e.g. `/workspace`). **Cursor** still attaches but you get a window **without** that folder as the opened workspace.

**Mechanical reason in SaifCTL:** For branch 1, we do:

```ts
await vscode.commands.executeCommand('remote-containers.attachToRunningContainer', …);
return true;
```

If that `executeCommand` **completes without throwing**, we **return immediately** and **never run branch 2**. Branch 2 is the only place we pass **`session.workspacePath`** into a `vscode-remote://…` folder URI we control. So whatever folder (if any) is opened in branch 1 is decided **entirely inside** Dev Containers — not by `run info`’s `workspacePath` unless their code uses the same value.

**Microsoft Dev Containers (VSIX ~0.452.x, minified `fC`):** After resolving the container and building the `attached-container+…` authority, it chooses:

- **`vscode.openFolder(vscode-remote://…authority + workspaceFolderPath, { forceNewWindow: true })`** when it has a **`workspaceFolderPath`**, else
- **`vscode.newWindow({ remoteAuthority })`** only (remote session **without** an initial folder).

The **`workspaceFolderPath`** comes from optional persisted attach metadata: function **`uz(globalStoragePath, container)`** tries, in order, JSON under **`nameConfigs/<encoded-container-name>.json`**, then **`imageConfigs/<encoded-image-id>.json`** in the extension’s **globalStorage** directory for **`ms-vscode-remote.remote-containers`**. Parsed config can supply **`workspaceFolder`** (e.g. `/workspace`). If you have attached before, or an image/name config exists, VS Code is more likely to call **`openFolder`** with that path.

**Cursor fork (e.g. `anysphere.remote-containers`, `dist/main.js`):** Same **shape** of decision: after **`inspectContainer`**, **`getConfigForContainer`** (and related state) yields an object; if **`workspaceFolder`** is set, Cursor calls **`vscode.openFolder`** with the remote URI + that path; otherwise **`vscode.newWindow({ remoteAuthority })`** only. Storage keys and defaults can differ (e.g. **`globalStorage/anysphere.remote-containers/`** vs Microsoft’s folder; `package.json` **`jsonValidation`** even references both for attach configs). For **ephemeral** inspect containers with **no** prior attach JSON, Cursor’s path may resolve **no** `workspaceFolder` more often than Microsoft’s **`uz`** path, so you see authority-only windows.

**Why we keep SaifCTL’s branch order as-is:** Reordering so **`vscode.openFolder`** runs **before** `attachToRunningContainer` (or always running **`openFolder` first**) was tried and **broke Cursor** integration. Reordering is not a free fix.

**Implications:** While branch 1 “succeeds” without throwing but opens **no** folder, branch 2 **never runs**, so SaifCTL cannot apply **`session.workspacePath`** unless we add **new** behavior (e.g. Cursor-only follow-up `openFolder`, or skipping branch 1 on Cursor only — both need design and testing to avoid double windows or regressions).

**Skipping branch 1 on Cursor (branch 2 first) — do not ship for SSH Remote:** We tried skipping branch 1 on Cursor so branch 2’s `vscode.openFolder` with `vscode-remote://attached-container+…/session.workspacePath` would always run. That **broke** setups where the SaifCTL window is an **`ssh-remote`** session: Dev Containers consulted the **local** (laptop) Docker daemon to resolve the container instead of Docker on the SSH host. Branch 1’s `remote-containers.attachToRunningContainer` is the path that keeps Docker targeting aligned with Dev Containers’ remote/SSH logic in those environments. **Do not** skip branch 1 just to fix the missing-folder symptom when users may work over SSH.

**To verify in bundles:** In Microsoft’s `extension.js`, locate **`function fC`** and **`async function uz`** (globalStorage **`nameConfigs` / `imageConfigs`**). In Cursor’s `main.js`, locate **`getConfigForContainer`** next to **`registerCommand("remote-containers.attachToRunningContainer"`** and compare when **`workspaceFolder`** is set vs omitted.

---

## 4. Other gotchas we hit (same feature area)

### 4.1 `vscode.openFolder` third argument must be an options object

Dev Containers internally uses:

```ts
vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
```

not `…, true)`. Passing a bare boolean can fail or behave oddly. Our fallbacks use `{ forceNewWindow: true }`.

### 4.2 `attached-container+…` remote authority

Hex-encoded JSON payload (e.g. `{ containerName, settings: { host: 'ssh://…' } }` when attaching over SSH) is documented in community threads such as [vscode-remote-release#5171](https://github.com/microsoft/vscode-remote-release/issues/5171). Microsoft’s attach path eventually opens `vscode-remote://attached-container+…/path` or `vscode.newWindow({ remoteAuthority })`.

### 4.3 Container Tools vs Dev Containers

**Container Tools** (`ms-azuretools.vscode-containers`) does **not** implement “open editor inside container.” It contributes **Attach Shell**, **Open in Browser**, file open via the `containers:` filesystem, etc.

The context menu **“Attach Visual Studio Code”** / **“Attach Cursor…”** on the Container Tools tree is contributed by **Dev Containers**: it wires `remote-containers.attachToRunningContainerFromViewlet` to `view == vscode-containers.views.containers` with a running-container `viewItem`. The row is still Container Tools; the command is Dev Containers.

### 4.4 Command id renames (manifest only)

Example: Microsoft may expose **`remote-containers.openFolderInContainerInNewWindow`** while Cursor lists **`remote-containers.attachToContainerInNewWindow`** for the same UX. Always diff **`contributes.commands`** when assuming a command id exists on both hosts.

---

## 5. Reproducible methodology: manifests (commands, schemas, settings)

Complete **§0** first so `vendor/dev-containers-manifests/` and `vendor/cursor-remote-containers/` exist.

### 5.1 Microsoft: query Marketplace, download VSIX, write `package.json` under `vendor/`

The extension is on the Visual Studio Marketplace as **`ms-vscode-remote.remote-containers`**. You do **not** need the closed-source repo; the shipped VSIX contains `extension/package.json`, schemas, and the bundled JS.

**Query version and VSIX URL** (adjust `api-version` if the API changes):

```bash
curl -sS -X POST "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json;api-version=3.0-preview.1" \
  -d '{
    "filters": [{
      "criteria": [{ "filterType": 7, "value": "ms-vscode-remote.remote-containers" }],
      "pageNumber": 1,
      "pageSize": 1,
      "sortBy": 0,
      "sortOrder": 0
    }],
    "assetTypes": ["Microsoft.VisualStudio.Services.VSIXPackage"],
    "flags": 914
  }' | python3 -c "
import json, sys
r = json.load(sys.stdin)['results'][0]['extensions'][0]['versions'][0]
print('version:', r['version'])
for f in r['files']:
  if f.get('assetType') == 'Microsoft.VisualStudio.Services.VSIXPackage':
    print('vsix:', f['source'])
    break
"
```

**Download VSIX, extract `package.json`, save with a versioned name** (replace `VERSION` and `VSIX_URL` with values from the command above):

```bash
VERSION='0.452.0'   # example; use the printed version
VSIX_URL='<paste vsix URL from above>'
OUT="vendor/dev-containers-manifests/ms-remote-containers-${VERSION}.package.json"
mkdir -p vendor/dev-containers-manifests
curl -sSL -o /tmp/remote-containers-ms.vsix "$VSIX_URL"
unzip -p /tmp/remote-containers-ms.vsix extension/package.json > "$OUT"
echo "Wrote $OUT"
export MS_PKG="$OUT"
```

**Optional — generate a trimmed `contributes` snapshot** (easier to diff than the full minified one-line JSON):

```bash
python3 - <<'PY'
import json, os, pathlib
ms_pkg = pathlib.Path(os.environ["MS_PKG"])
d = json.loads(ms_pkg.read_text())
c = d.get("contributes", {})
out = {
    "name": d.get("name"),
    "version": d.get("version"),
    "publisher": d.get("publisher"),
    "activationEvents": d.get("activationEvents"),
    "commands": c.get("commands"),
    "menus": c.get("menus"),
    "views": c.get("views"),
    "viewsContainers": c.get("viewsContainers"),
    "jsonValidation": c.get("jsonValidation"),
    "configuration": c.get("configuration"),
    "keybindings": c.get("keybindings"),
    "customEditors": c.get("customEditors"),
    "authentication": c.get("authentication"),
}
path = ms_pkg.parent / ms_pkg.name.replace(".package.json", ".contributes.json")
path.write_text(json.dumps(out, indent=2))
print("Wrote", path)
PY
```

**Compare interesting slices:** `commands`, `menus`, `views`, `viewsContainers`, `jsonValidation`, `configuration`, and top-level **`activationEvents`** (not under `contributes`).

### 5.2 Cursor: copy installed extension into `vendor/cursor-remote-containers/`

Cursor’s build is **not** reliably available via the same Marketplace query as a separate public extension id in all environments.

1. In **Cursor**: Extensions → **Dev Containers** (publisher Anysphere) → **Open Extension Folder** / reveal in Finder (wording varies).
2. Copy the **entire** extension directory (e.g. `anysphere.remote-containers-1.0.32`) into:

   `vendor/cursor-remote-containers/anysphere.remote-containers-<VERSION>/`

3. Set variables (see §0):

```bash
export CURSOR_EXT="vendor/cursor-remote-containers/anysphere.remote-containers-1.0.32"
export CR_PKG="$CURSOR_EXT/package.json"
export CR_MAIN="$CURSOR_EXT/dist/main.js"
```

That tree includes:

- `package.json` — command titles, `jsonValidation` `fileMatch` / `url`, configuration keys.
- `resources/schemas/*.json` — JSON Schema files Cursor ships **locally** (Microsoft may point `jsonValidation` at a **remote** URL for some files).
- `dist/main.js` (or equivalent) — **runtime** implementation to compare with Microsoft’s bundle.

**Optional — Cursor contributes snapshot** (same shape as Microsoft’s optional file):

```bash
python3 - <<'PY'
import json, os, pathlib
cr_pkg = pathlib.Path(os.environ["CR_PKG"])
d = json.loads(cr_pkg.read_text())
c = d.get("contributes", {})
out = {
    "name": d.get("name"),
    "version": d.get("version"),
    "publisher": d.get("publisher"),
    "activationEvents": d.get("activationEvents"),
    "commands": c.get("commands"),
    "menus": c.get("menus"),
    "views": c.get("views"),
    "viewsContainers": c.get("viewsContainers"),
    "jsonValidation": c.get("jsonValidation"),
    "configuration": c.get("configuration"),
    "keybindings": c.get("keybindings"),
    "customEditors": c.get("customEditors"),
    "authentication": c.get("authentication"),
}
path = cr_pkg.parent / "cursor-dev-containers.contributes.json"
path.write_text(json.dumps(out, indent=2))
print("Wrote", path)
PY
```

Then in your shell (adjust path to match the folder you copied):

```bash
export CR_CONTRIBS="vendor/cursor-remote-containers/anysphere.remote-containers-1.0.32/cursor-dev-containers.contributes.json"
```

### 5.3 Structured diff (commands and more)

After `MS_PKG` and `CR_PKG` point at real files:

```bash
python3 -c "
import json, os
def cmd_ids(path):
    d = json.load(open(path))
    return sorted(c['command'] for c in d['contributes']['commands'])
ms = set(cmd_ids(os.environ['MS_PKG']))
cr = set(cmd_ids(os.environ['CR_PKG']))
print('only MS', len(ms - cr))
print('only Cursor', len(cr - ms))
"
```

**Trimmed contributes diff** (if you generated both `*.contributes.json` files):

```bash
MS_C="${MS_PKG%.package.json}.contributes.json"
CR_C="$(dirname "$CR_PKG")/cursor-dev-containers.contributes.json"
diff -u "$MS_C" "$CR_C" | less
```

**`jsonValidation`:** diff the `fileMatch` + `url` pairs; Cursor often uses `./resources/schemas/...` and `%APP_SETTINGS_HOME%/globalStorage/...` for attach configs.

You can keep a personal **`vendor/dev-containers-manifests/COMPARISON.md`** (or **`docs/...`**) with notes; nothing under `vendor/` is required to exist in git.

---

## 6. Reproducible methodology: runtime behavior (minified JS)

When the manifest says two hosts expose the same `command` id, **implementation can still differ**. The attach bug was only visible by reading the bundle.

Complete **§0**, **§5.1** (Microsoft VSIX), and **§5.2** (Cursor copy) so you have files on disk.

### 6.1 Locate the registration

- **Microsoft:** unzip the VSIX (or use the file already in `/tmp` from §5.1) and open `extension/dist/extension/extension.js` (exact path inside the VSIX can vary by version).
- **Cursor:** use `"$CR_MAIN"` (e.g. `dist/main.js`).

Search for:

`registerCommand("remote-containers.attachToRunningContainer"`

### 6.2 Isolate the handler body

Use a short Node script to print a window of characters **before** that string until you see the function that is passed as the handler (Cursor used a single-letter symbol, e.g. `R`, in the minified output).

### 6.3 Search for user-visible errors

```bash
node -e "
const fs = require('fs');
const p = process.env.CR_MAIN;
if (!p) throw new Error('Set CR_MAIN to Cursor dist/main.js');
const s = fs.readFileSync(p, 'utf8');
for (const n of ['No container id found', 'attachToRunningContainer', 'containerId']) {
  let i = 0, c = 0;
  while ((i = s.indexOf(n, i + 1)) !== -1 && c++ < 5)
    console.log(n, i, JSON.stringify(s.slice(i, i + 200)));
}
"
```

Cross-check with Microsoft’s bundle inside the VSIX at the path from §6.1.

### 6.4 Confirm Docker-side behavior

Both implementations tend to run **`docker info`** before attach. If attach fails for both hosts with a different error, verify Docker is reachable from the **UI** extension host (local) vs **remote** SSH session—separate from the argument-shape bug.

---

## 7. SaifCTL resolution summary

| Step | Purpose |
|------|---------|
| Branch 1 | `remote-containers.attachToRunningContainer` with **string** (VS Code) or **`{ containerId }`** (Cursor). |
| Branch 2 | `vscode.openFolder(folderUri, { forceNewWindow: true })` with `vscode-remote://attached-container+…/workspacePath`. |
| Branch 3 | `vscode.newWindow({ remoteAuthority: 'attached-container+…' })`. |
| Branch 4 | `vscode.env.openExternal(folderUri)` as last resort. |
| SSH remote | Encode `settings.host: 'ssh://…'` in the attached-container payload; resolve host from workspace authority or `os.hostname()` when the extension runs on the remote. |

---

## 8. When Cursor or Microsoft ship updates

1. Re-run **§5.1** to download a new Microsoft VSIX and overwrite or add a new `ms-remote-containers-<VERSION>.package.json`.
2. Re-copy Cursor’s extension folder into `vendor/cursor-remote-containers/` (**§5.2**).
3. Re-diff `contributes` (**§5.3**) and re-scan both bundles for `attachToRunningContainer` / `containerId` (**§6**).
4. If Cursor aligns with Microsoft’s string argument, **`attachToRunningContainerCommandArg`** in `inspectAttach.ts` can be simplified or removed.

---

## 9. References

- [vscode-remote-release#5171 — container parameter for attach](https://github.com/microsoft/vscode-remote-release/issues/5171)
- [microsoft/vscode-containers](https://github.com/microsoft/vscode-containers) (Container Tools; not the attach-to-editor implementation)
- In-repo implementation: `vscode-ext/src/inspectAttach.ts`
