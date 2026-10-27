// To-Do widgets for Scriptable. Shows what's left to do today from Jackson's lists in the private
// briefings repo (the same files the phone app, the new-tab page and Claude use): every open item
// dated today or earlier, oldest first. Downloaded and run by todo-loader.js; read-only.
//
// Widget Parameter picks the list: blank or "todo" (main list), "jen", "supervisors".
// Sizes: Home Screen small, medium, large; Lock Screen circle, rectangle, inline.

const REPO = "jacksonkottke/briefings";
const KEY = "todo-widget-token";
const APP_URL = "https://jacksonkottke.github.io/todo/";
const LISTS = {
  todo: { path: "_todos/todos.json", title: "To-Do", short: "to-dos", noun: ["to-do", "to-dos"] },
  jen: { path: "_todos/jen.json", title: "1:1 With Jen", short: "Jen", noun: ["topic", "topics"] },
  supervisors: { path: "_todos/supervisors.json", title: "Supervisors", short: "Supes", noun: ["topic", "topics"] },
};
const FM = FileManager.local();
const DIR = FM.joinPath(FM.cacheDirectory(), "todo-widgets");
if (!FM.fileExists(DIR)) FM.createDirectory(DIR, true);

// ---- Midwest ENT look (light, dark) ----
const dyn = (l, d) => Color.dynamic(new Color(l), new Color(d));
const T = {
  bg: dyn("#ffffff", "#13233a"), heading: dyn("#123155", "#e3ebf4"), ink: dyn("#4a4a4a", "#d3d9e0"),
  muted: dyn("#757575", "#8e98a4"), teal: dyn("#0e9288", "#2fc4b8"), rule: dyn("#e5e5e5", "#24364f"),
  old: dyn("#8a5a00", "#e0b25a"),
};
const F = {
  title: s => new Font("Georgia", s), item: s => Font.systemFont(s), bold: s => Font.boldSystemFont(s),
  ui: s => Font.semiboldSystemFont(s), round: s => Font.boldRoundedSystemFont(s),
};

// ---- Dates ----
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
const today = ymd(new Date());
const age = date => Math.round((parseYmd(today) - parseYmd(date)) / 86400000);

// ---- Data ----
async function token(ask) {
  if (Keychain.contains(KEY) && !ask) return Keychain.get(KEY);
  if (config.runsInWidget) return null;
  const a = new Alert();
  a.title = "To-Do widgets";
  a.message = "Paste a fine-grained GitHub token that can read jacksonkottke/briefings (Contents: read-only is enough; the phone app's token works too). It is stored in this iPhone's Keychain.";
  a.addSecureTextField("github_pat_…", "");
  a.addAction("Save"); a.addCancelAction("Cancel");
  if ((await a.present()) === -1) return null;
  const t = a.textFieldValue(0).trim();
  if (t) Keychain.set(KEY, t);
  return t || null;
}

async function load(list, tok) {
  const file = FM.joinPath(DIR, list.path.replace(/\W/g, "_"));
  try {
    const r = new Request(`https://api.github.com/repos/${REPO}/contents/${list.path}?ref=main`);
    r.headers = { Accept: "application/vnd.github.raw+json", Authorization: `Bearer ${tok}`, "X-GitHub-Api-Version": "2022-11-28" };
    r.timeoutInterval = 15;
    const data = await r.loadJSON();
    const status = r.response && r.response.statusCode;
    if (status !== 200 || !data || !Array.isArray(data.items)) {
      const auth = status === 401 || status === 403 || status === 404;
      throw Object.assign(new Error(status === 401 ? "GitHub didn't accept the token. Run the script with ?reset=1 to replace it." : auth ? "The token can't read the briefings repo." : (data && data.message) || "GitHub error"), { auth });
    }
    FM.writeString(file, JSON.stringify(data));
    return { items: data.items, stale: false };
  } catch (e) {
    if (!e.auth && FM.fileExists(file)) return { items: JSON.parse(FM.readString(file)).items || [], stale: true };
    throw e;
  }
}

// Same rule as the app's Today view: open items planned for today or earlier carry forward.
const leftToday = items => items
  .filter(i => i && !i.deleted && !i.done && i.date && i.date <= today)
  .sort((a, b) => String(a.date).localeCompare(b.date) || (a.created || 0) - (b.created || 0));

// Links show as their label; long bare links shrink to the site name.
const plain = s => String(s || "")
  .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
  .replace(/https?:\/\/([^\s/]+)[^\s]*/g, (m, host) => host.replace(/^www\./, ""))
  .replace(/\s+/g, " ").trim();

// ---- Drawing ----
function text(stack, s, font, color, lines = 1, scale = 0.85) {
  const t = stack.addText(String(s)); t.font = font; t.textColor = color; t.lineLimit = lines; t.minimumScaleFactor = scale; return t;
}
const count = (n, noun) => `${n} ${n === 1 ? noun[0] : noun[1]}`;

function header(w, list, n, stale, size) {
  const row = w.addStack(); row.layoutHorizontally(); row.centerAlignContent();
  text(row, list.title, F.title(size), T.heading);
  row.addSpacer();
  text(row, stale ? "offline" : (n ? String(n) : ""), F.round(size - 2), stale ? T.muted : T.teal);
  const bar = w.addStack(); bar.size = new Size(0, 2); bar.backgroundColor = T.teal;
  return row;
}

function itemRow(w, item, font, lines) {
  const row = w.addStack(); row.layoutHorizontally(); row.topAlignContent();
  const box = row.addStack(); box.size = new Size(9, 9); box.borderWidth = 1.5; box.borderColor = T.teal; box.cornerRadius = 1;
  row.addSpacer(6);
  const col = row.addStack(); col.layoutVertically();
  const old = age(item.date) > 7;
  text(col, plain(item.text), font, T.ink, lines, 0.9);
  if (old) text(col, `${age(item.date)} days`, F.ui(9), T.old);
  return row;
}

function homeWidget(list, items, stale, fam) {
  const w = new ListWidget(); w.backgroundColor = T.bg; w.url = APP_URL;
  const small = fam === "small", large = fam === "large" || fam === "extraLarge";
  w.setPadding(small ? 12 : 14, 14, small ? 12 : 14, 14);
  header(w, list, items.length, stale, small ? 15 : 17);
  w.addSpacer(small ? 6 : 8);
  if (!items.length) {
    text(w, "All done for today.", F.item(small ? 13 : 14), T.muted, 2);
    w.addSpacer();
    return w;
  }
  const max = small ? 3 : large ? 11 : 4, lines = small ? 2 : large ? 2 : 1;
  items.slice(0, max).forEach((it, i) => { if (i) w.addSpacer(small ? 5 : 6); itemRow(w, it, F.item(small ? 12 : 13), lines); });
  w.addSpacer();
  if (items.length > max) text(w, `+${items.length - max} more`, F.ui(11), T.muted);
  return w;
}

function lockWidget(list, items, stale, fam) {
  const w = new ListWidget(); w.url = APP_URL;
  const n = items.length;
  if (fam === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const v = w.addStack(); v.layoutVertically(); v.centerAlignContent();
    const a = v.addStack(); a.addSpacer(); text(a, n ? String(n) : "✓", F.round(n > 9 ? 20 : 24), Color.white()); a.addSpacer();
    const b = v.addStack(); b.addSpacer(); text(b, list.short, F.ui(9), Color.white(), 1, 0.6); b.addSpacer();
    return w;
  }
  if (fam === "accessoryInline") {
    text(w, n ? `${count(n, list.noun)} left · ${plain(items[0].text)}` : `${list.title}: all done`, F.ui(12), Color.white());
    return w;
  }
  // accessoryRectangular
  text(w, n ? `${list.title} · ${n} left${stale ? " · offline" : ""}` : `${list.title} · all done`, F.bold(13), Color.white());
  items.slice(0, 2).forEach(it => text(w, "▢ " + plain(it.text), F.item(12), Color.white(), 1, 0.8));
  return w;
}

function errorWidget(msg) {
  const w = new ListWidget(); w.backgroundColor = T.bg; w.url = APP_URL;
  if ((config.widgetFamily || "").startsWith("accessory")) { text(w, "To-Do: " + msg, F.ui(11), Color.white(), 3); return w; }
  text(w, "To-Do widgets", F.ui(11), T.muted); w.addSpacer(4); text(w, msg, F.item(12), T.ink, 4);
  return w;
}

// ---- Main ----
const param = (args.widgetParameter || "").trim().toLowerCase();
const list = LISTS[param.startsWith("jen") ? "jen" : param.startsWith("sup") ? "supervisors" : "todo"];
const fam = config.widgetFamily || "medium";
let widget;
try {
  const tok = await token(!config.runsInWidget && args.queryParameters && args.queryParameters.reset);
  if (!tok) widget = errorWidget("Open Scriptable and run this script once to save your GitHub token.");
  else {
    const { items, stale } = await load(list, tok);
    const left = leftToday(items);
    widget = fam.startsWith("accessory") ? lockWidget(list, left, stale, fam) : homeWidget(list, left, stale, fam);
    widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  }
} catch (e) {
  widget = errorWidget("Couldn't load: " + e.message);
}
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
