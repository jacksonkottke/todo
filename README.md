# To-Do (phone)

A small web app for Jackson's to-do lists, installed to the phone's home screen. It reads and writes the same files as the Briefings new-tab extension and Claude: `_todos/todos.json`, `_todos/jen.json` and `_todos/supervisors.json` in the private `jacksonkottke/briefings` repo.

This repo holds only the app's code. It contains no to-dos and no token, so it can be public; the lists stay in the private repo, and the app does nothing without a token that can read it.

## Use

1. Open <https://jacksonkottke.github.io/todo/> in Safari on the phone.
2. Paste a GitHub fine-grained token: Repository access → **Only select repositories** → `briefings`; Permissions → **Contents: Read and write**. The token is stored only in that browser.
3. Share → **Add to Home Screen**.

## How it syncs

Same rules as the extension (see `_todos/README.md` in the briefings repo): items merge by `id`, the copy with the later `updated` wins, deletes are kept as `deleted: true`, and a write that loses a race merges again and retries. It syncs on open, every minute while open, after each change, and with the ⟳ button. Changes made offline are kept on the phone and sync later.

## Files

`index.html`, `app.css`, `app.js` (all logic), `sw.js` (offline copy of the app; never caches GitHub data), `manifest.webmanifest`, `icons/`, `fonts/` (Mulish and Ibarra Real Nova, SIL Open Font License).
