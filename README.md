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

## Widgets (Scriptable)

Home Screen and Lock Screen widgets showing what's left to do today: every open item dated today or earlier, oldest first, with items open more than a week marked by age.

- `scriptable/todo-loader.js`: the short script pasted into Scriptable once, as **To-Do Widgets**. Each refresh downloads the current `todo-widgets.js` from this repo (public, so no token needed for the code) and keeps a copy for when GitHub can't be reached, so changes to the widgets reach the phone without pasting again.
- `scriptable/todo-widgets.js`: the widgets. They read the lists from the private briefings repo with a token kept in the iPhone Keychain (read-only is enough; the app's token also works). Read-only: widgets never change the lists.

Setup: in Scriptable tap +, name the script `To-Do Widgets`, paste `todo-loader.js`, run it once and paste the token. Then add a Scriptable widget and choose **To-Do Widgets**. Widget **Parameter**: blank (main list), `jen` or `supervisors`.

| Size | Shows |
| --- | --- |
| Home small / medium / large | Title, count, and the first 3 / 4 / 11 items |
| Lock Screen circle | Count left today |
| Lock Screen rectangle | Count and the first two items |
| Lock Screen inline | Count and the first item |

Tapping a widget opens the app's page in Safari (iOS can't open a Home Screen web app from a widget; Safari keeps its own copy of the token, so connect once there too). To replace the widget token, open `scriptable:///run/To-Do%20Widgets?reset=1`. iOS decides how often widgets refresh, usually every 15 to 30 minutes.
