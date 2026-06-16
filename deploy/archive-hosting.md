# Archive Hosting

This project now includes a polished Notion export editor at `Archive/`.

## Regenerate the archive

```powershell
npm run archive:build -- "C:\Users\gya03\OneDrive\Desktop\개인 페이지 & 공유된 페이지"
```

The command reads the Notion export folder and writes:

- `assets/data/notion-archive-data.js`
- `assets/notion-media/`

The source export folder is not modified.

## Static hosting

Upload these paths together:

- `index.html`
- `Archive/`
- `assets/css/notion-hub.css`
- `assets/js/notion-hub.js`
- `assets/data/notion-archive-data.js`
- `assets/notion-media/`

The archive tool can run without an API server. In that mode, edits are saved in the browser's `localStorage`; use the in-app export/import JSON controls when moving changes between machines or deployments.

The in-app `HTML 내보내기` button exports an editable Archive app shell with the current archive state embedded. Keep it beside the `assets/` folder when hosting it. The separate `HTML 보고서` button exports a read-only report-style HTML file.

## Node hosting

For a hosted editable archive through the bundled server:

```powershell
$env:AUTH_DISABLED="1"
$env:PORT="8770"
npm start
```

Then open:

```text
http://127.0.0.1:8770/Archive/
```

The server exposes `/api/archive/state` and `/api/archive/save`. Archive edits are persisted to `.collab/archive-state.json`, which is intentionally local runtime state and ignored by git.

For public hosting, keep auth enabled with the current MySQL-backed setup so only `admin` and `editor` users can save archive edits. `AUTH_DISABLED="1"` is only for local/private use.
