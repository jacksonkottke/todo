// To-Do widgets loader for Scriptable. Paste this once as the script "To-Do Widgets".
// Each run downloads the current scriptable/todo-widgets.js from the public jacksonkottke/todo repo,
// keeps a copy, and runs it; if GitHub can't be reached it runs the last copy it saved. Changes to
// the widgets then reach the phone by themselves. Your lists are read by the widget code with the
// token in the iPhone Keychain; this loader needs no token (the code repo is public).

const TODO_URL = "https://raw.githubusercontent.com/jacksonkottke/todo/main/scriptable/todo-widgets.js";
const TODO_FM = FileManager.local();
const TODO_DIR = TODO_FM.joinPath(TODO_FM.cacheDirectory(), "todo-widgets");
const TODO_FILE = TODO_FM.joinPath(TODO_DIR, "todo-widgets.js");
if (!TODO_FM.fileExists(TODO_DIR)) TODO_FM.createDirectory(TODO_DIR, true);

async function todoCode() {
  try {
    const r = new Request(TODO_URL + "?t=" + Date.now());
    r.timeoutInterval = 15;
    const code = await r.loadString();
    if (r.response && r.response.statusCode === 200 && code.includes("Script.setWidget")) {
      TODO_FM.writeString(TODO_FILE, code);
      return code;
    }
  } catch (e) { /* fall back to the saved copy */ }
  return TODO_FM.fileExists(TODO_FILE) ? TODO_FM.readString(TODO_FILE) : null;
}

const todoSource = await todoCode();
if (todoSource) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(todoSource)();
} else {
  const w = new ListWidget();
  w.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#13233a"));
  const t = w.addText("Couldn't download the To-Do widgets. Check the connection and try again.");
  t.font = Font.systemFont(12); t.textColor = Color.dynamic(new Color("#4a4a4a"), new Color("#d3d9e0"));
  if (config.runsInWidget) Script.setWidget(w); else await w.presentSmall();
  Script.complete();
}
