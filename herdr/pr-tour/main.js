import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, props, shared, setShared, nextCommand } from "herdr";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const PROGRESS = "pr-tour.progress";
const MAX_ROWS = 400;
const CONTEXT = 3;
const EXPAND_STEP = 20;
const FOLD_AFTER = 8;
// Herdr stops a render that runs too long, then waits ~16 s before trying again. Right after
// a tab opens, scripts run far slower than usual, so a render that normally takes a few ms
// can hit that limit. Past this budget, the remaining diffs render as placeholders and
// another render is scheduled.
const RENDER_BUDGET_MS = 60;
// Diff rows the first render after a load may draw; each follow-up render doubles it.
const FIRST_ROW_CAP = 40;
const short = (sha) => (sha ?? "").slice(0, 7);
const tourFileName = (branch) => `${branch.replaceAll("/", "__")}.json`;

function openedFrom() {
  const given = props() ?? {};
  if (given.repo) return given.repo;
  const f = focused(), pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  return pane?.cwd || f?.cwd || spaces().find((s) => s.active)?.folder;
}

function parseDiff(text) {
  const hunks = [];
  let hunk = null, old = 0, next = 0;
  for (const line of text.replace(/\n$/, "").split("\n")) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/.exec(line);
    if (match) {
      old = +match[1]; next = +match[3];
      hunk = { header: line, oldStart: old, oldLen: +(match[2] ?? 1), newStart: next, newLen: +(match[4] ?? 1), rows: [] };
      hunks.push(hunk);
      continue;
    }
    if (!hunk || line.startsWith("\\")) continue;
    const kind = line[0], body = line.slice(1).replaceAll("\t", "    ") || " ";
    if (kind === "-") hunk.rows.push({ kind, old: old++, text: body });
    else if (kind === "+") hunk.rows.push({ kind, new: next++, text: body });
    else if (kind === " ") hunk.rows.push({ kind, old: old++, new: next++, text: body });
  }
  return hunks;
}

// The whole file as one list: each hunk's rows, with the unchanged lines between hunks
// (from the new file) filled in, so an anchor's window can grow past its hunk.
// Without the new file (deleted at head), only the hunks are known.
function fileRows(hunks, lines) {
  const rows = [];
  let oldAt = 1, newAt = 1;
  const fill = (until) => {
    for (; newAt <= until; newAt++, oldAt++) {
      if (lines) rows.push({ kind: " ", gap: true, old: oldAt, new: newAt, text: (lines[newAt - 1] ?? "").replaceAll("\t", "    ") || " " });
    }
  };
  hunks.forEach((h, i) => {
    fill(h.newLen === 0 ? h.newStart : h.newStart - 1);
    for (const row of h.rows) rows.push({ ...row, hunk: i });
    oldAt = h.oldLen === 0 ? h.oldStart + 1 : h.oldStart + h.oldLen;
    newAt = h.newLen === 0 ? h.newStart + 1 : h.newStart + h.newLen;
  });
  if (lines) fill(lines.length);
  return rows;
}

const jumpsBetween = (a, b) => a.hunk !== undefined && b.hunk !== undefined && a.hunk !== b.hunk;

const GITHUB = {
  dark: {
    canvas: "#0d1117", fg: "#f0f6fc", muted: "#9198a1", border: "#3d444d", header: "#151b23",
    add: { line: "#2ea04326", num: "#3fb9504d", sign: "#3fb950" },
    del: { line: "#f8514926", num: "#f851494d", sign: "#f85149" },
    hunk: { line: "#388bfd1a", num: "#388bfd33" },
    selected: "#d29922",
  },
  light: {
    canvas: "#ffffff", fg: "#1f2328", muted: "#59636e", border: "#d1d9e0", header: "#f6f8fa",
    add: { line: "#dafbe1", num: "#aceebb", sign: "#1a7f37" },
    del: { line: "#ffebe9", num: "#ffcecb", sign: "#d1242f" },
    hunk: { line: "#ddf4ff", num: "#b6e3ff" },
    selected: "#9a6700",
  },
};
const github = () => (settings().dark === false ? GITHUB.light : GITHUB.dark);

function inAnchor(row, anchor) {
  const n = anchor.side === "old" ? row.old : row.new;
  return n !== undefined && n >= anchor.start && n <= anchor.end;
}

export default class PrTour extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.diffs = {};
    this.closelyOnly = false;
    this.status = "Looking for a tour…";
    this.locate(cx);
    // Finishes a page that ran out of render budget, with a larger row cap each time.
    cx.timer.every(150, (cx) => {
      if (!this.deferred) return;
      this.deferred = false;
      this.rowCap = (this.rowCap ?? FIRST_ROW_CAP) * 2;
      cx.notify();
    });
    cx.spawn(async (cx) => {
      const keys = { next: "j", prev: "k", reviewed: "space", filter: "f" };
      for (;;) {
        const command = await nextCommand();
        if (this.tour && keys[command]) this.onKey({ key: keys[command] }, { stop_propagation() {}, notify() {} });
        cx.notify();
      }
    });
  }

  locate(cx) {
    const folder = openedFrom(), given = props() ?? {};
    cx.spawn(async (cx) => {
      try {
        const git = (args, cwd = folder) => exec("git", [...READ, ...args], { cwd });
        const top = await git(["rev-parse", "--show-toplevel"]);
        if (top.code !== 0) throw new Error(`Not a git repository: ${folder}`);
        this.root = top.stdout.trim();
        const common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], this.root);
        const branch = given.branch ?? (await git(["symbolic-ref", "--short", "HEAD"], this.root)).stdout.trim();
        if (!branch) throw new Error("Detached HEAD: open the tour with a branch");
        this.branch = branch;
        this.folder = `${common.stdout.trim()}/pr-tours`;
        this.path = given.tour ?? `${this.folder}/${tourFileName(branch)}`;
        await exec("mkdir", ["-p", this.folder]);
        await this.load();
        cx.notify();
        for (;;) {
          const changed = await watchFolder(this.folder);
          const lock = this.path.replace(/\.json$/, ".lock");
          if (changed.some((p) => p === this.path || p === lock)) { await this.load(); cx.notify(); }
        }
      } catch (e) {
        this.status = String(e.message ?? e);
        cx.notify();
      }
    });
  }

  async load() {
    const text = await readTextFile(this.path);
    if (text === null) {
      this.tour = null;
      const writing = await readTextFile(this.path.replace(/\.json$/, ".lock"));
      this.status = writing !== null
        ? `Writing the tour for ${this.branch}… It shows here when it's ready.`
        : `No tour yet for ${this.branch}. Run /pr-tour in its session, or pr-tour in a terminal.`;
      return;
    }
    let tour;
    try { tour = JSON.parse(text); } catch (e) { this.tour = null; this.status = `Tour is not valid JSON: ${e.message}`; return; }
    if (tour.version !== 1 || !Array.isArray(tour.steps)) { this.tour = null; this.status = "Tour has an unknown format (expected version 1)"; return; }
    this.tour = tour;
    this.diffs = {};
    this.windows = {};
    this.rowCap = FIRST_ROW_CAP;
    const tip = await exec("git", [...READ, "rev-parse", tour.branch ?? this.branch], { cwd: this.root });
    this.tip = tip.code === 0 ? tip.stdout.trim() : null;
    const files = new Set([...tour.steps.flatMap((s) => s.anchors.map((a) => a.file)), ...tour.concerns.filter((c) => c.anchor).map((c) => c.anchor.file)]);
    await Promise.all([...files].map(async (file) => {
      const [diff, show] = await Promise.all([
        exec("git", [...READ, "diff", "--no-ext-diff", "--no-color", tour.base_sha, tour.head_sha, "--", file], { cwd: this.root }),
        exec("git", [...READ, "show", "--no-textconv", `${tour.head_sha}:${file}`], { cwd: this.root }),
      ]);
      if (diff.code !== 0) { this.diffs[file] = { error: diff.stderr.trim() }; return; }
      const lines = show.code === 0 && !show.stdout.includes("\0") ? show.stdout.replace(/\n$/, "").split("\n") : null;
      const hunks = parseDiff(diff.stdout);
      this.diffs[file] = { hunks, rows: fileRows(hunks, lines) };
    }));
    if (!this.entries().some((e) => e.id === this.progress().current)) this.go(this.entries()[0].id);
  }

  key() { return `${this.root}#${this.tour.branch}#${this.tour.head_sha}`; }
  progress() { return (shared(PROGRESS) ?? {})[this.key()] ?? { done: {}, current: "overview" }; }
  saveProgress(change) {
    const all = shared(PROGRESS) ?? {};
    setShared(PROGRESS, { ...all, [this.key()]: { ...this.progress(), ...change } });
  }

  entries() {
    const steps = this.tour.steps.filter((s) => !this.closelyOnly || s.tag === "read_closely");
    return [{ id: "overview" }, ...steps.map((s) => ({ id: s.id, step: s })), { id: "concerns" }];
  }

  go(id) { this.saveProgress({ current: id }); }
  move(delta) {
    const list = this.entries(), at = Math.max(0, list.findIndex((e) => e.id === this.progress().current));
    this.go(list[Math.min(list.length - 1, Math.max(0, at + delta))].id);
  }
  toggleDone(id) {
    if (id === "overview" || id === "concerns") return;
    const done = { ...this.progress().done };
    if (done[id]) delete done[id]; else done[id] = true;
    this.saveProgress({ done });
  }

  onKey(e, cx) {
    const current = this.progress().current;
    if (e.key === "j" || e.key === "down") this.move(1);
    else if (e.key === "k" || e.key === "up") this.move(-1);
    else if (e.key === "space" || e.key === " ") { this.toggleDone(current); this.move(1); }
    else if (e.key === "f") { this.closelyOnly = !this.closelyOnly; if (!this.entries().some((x) => x.id === current)) this.go("overview"); }
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  pill(text, fg, bg) {
    return div().px(6).py(1).rounded(4).text_size(10).font_semibold().text_color(fg).when(Boolean(bg), (e) => e.bg(bg)).child(text);
  }

  tagPill(step, t) {
    return step.tag === "read_closely" ? this.pill("READ CLOSELY", t.accent_foreground, t.accent) : this.pill("SKIM", t.muted, t.raised);
  }

  button(id, label, onClick, t, primary = false) {
    return div().id(id).h(28).px(12).flex().items_center().rounded(7).cursor_pointer().text_size(12)
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .hover((s) => s.opacity(0.85)).on_click((_e, cx) => { onClick(); cx.notify(); }).child(label);
  }

  header(t) {
    const tour = this.tour, steps = tour.steps, done = this.progress().done;
    const doneCount = steps.filter((s) => done[s.id]).length, stale = this.tip && this.tip !== tour.head_sha;
    return v_flex().flex_none().border_b(1).border_color(t.border)
      .child(h_flex().h(42).px(14).gap(8).items_center()
        .child(div().font_semibold().child("Tour"))
        .child(div().min_w(0).truncate().text_color(t.muted).child(`${tour.branch} → ${tour.base}`))
        .child(div().text_size(11).text_color(t.dim).child(`${short(tour.base_sha)}..${short(tour.head_sha)}`))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.muted).child(`${doneCount}/${steps.length} reviewed`))
        .child(div().id("filter").h(24).px(8).flex().items_center().gap(6).rounded(6).cursor_pointer().text_size(11)
          .border_1().border_color(this.closelyOnly ? t.accent : t.border).text_color(this.closelyOnly ? t.accent : t.muted)
          .on_click((_e, cx) => { this.onKey({ key: "f" }, cx); })
          .child(this.closelyOnly ? "● Read closely only" : "○ Read closely only")))
      .when(stale, (e) => e.child(div().px(14).py(4).text_size(11).bg(t.blocked + "22").text_color(t.blocked)
        .child(`This tour is for ${short(tour.head_sha)}; the branch is now at ${short(this.tip)}. Line notes may be off.`)));
  }

  sidebar(t) {
    const { current, done } = this.progress();
    const row = (id, label, left, right) => h_flex().id(`entry-${id}`).flex_none().min_h(30).px(8).py(4).gap(8).items_center().rounded(7).cursor_pointer()
      .when(current === id, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.go(id); this.handle.focus(); cx.notify(); })
      .child(div().w(16).flex_none().text_center().child(left)).child(div().flex_1().min_w(0).child(label)).when(Boolean(right), (e) => e.child(right));
    let n = 0;
    return v_flex().id("tour-steps").w(250).flex_none().h_full().overflow_y_scrollbar().p(6).gap(1).border_r(1).border_color(t.border).children([
      row("overview", div().font_semibold().child("Overview"), div().text_color(t.dim).child("◇")),
      ...this.entries().filter((e) => e.step).map(({ id, step }) => {
        n += 1;
        const mark = done[id] ? div().text_color(t.done).child("✓") : div().text_size(11).text_color(t.dim).child(String(n));
        const dot = div().w(6).h(6).flex_none().rounded(3).bg(step.tag === "read_closely" ? t.accent : t.border);
        return row(id, v_flex().gap(1)
            .child(div().text_size(12).text_color(done[id] ? t.muted : t.foreground).child(step.title))
            .child(div().text_size(10).text_color(t.dim).truncate().child(step.anchors[0].file.split("/").pop() + (step.anchors.length > 1 ? ` +${step.anchors.length - 1}` : ""))),
          mark, h_flex().gap(4).items_center().when(Boolean(step.hotspot), (e) => e.child(div().text_size(11).text_color(t.blocked).child("★"))).child(dot));
      }),
      row("concerns", div().font_semibold().child(`Open concerns (${this.tour.concerns.length})`), div().text_color(t.blocked).child("!")),
    ]);
  }

  // Three elements per row (the render budget is tight): the line, one gutter with both
  // numbers (GitHub colors both columns alike; the anchor marker is its left border), the code.
  diffRow(row, anchor, g) {
    const hit = inAnchor(row, anchor), tone = row.kind === "+" ? g.add : row.kind === "-" ? g.del : null;
    const numbers = String(row.old ?? "").padStart(5) + String(row.new ?? "").padStart(6);
    return h_flex().w_full().h(20).flex_none().items_center().when(Boolean(tone), (e) => e.bg(tone.line))
      .child(div().w(91).h_full().flex_none().flex().items_center().justify_end().pr(8).border_l(3)
        .border_color(hit ? g.selected : "#00000000").text_color(g.muted).when(Boolean(tone), (e) => e.bg(tone.num)).child(numbers))
      .child(div().flex_1().min_w(0).pl(8).pr(10).truncate().text_color(g.fg).child(`${row.kind === " " ? " " : row.kind} ${row.text}`));
  }

  anchorView(anchor, key, t) {
    const g = github(), diff = this.diffs[anchor.file];
    const range = anchor.start === anchor.end ? `L${anchor.start}` : `L${anchor.start}–${anchor.end}`;
    const box = v_flex().flex_none().rounded(6).overflow_hidden().border_1().border_color(g.border).bg(g.canvas)
      .child(h_flex().h(36).px(12).gap(10).items_center().bg(g.header).border_b(1).border_color(g.border)
        .child(div().flex_1().min_w(0).truncate().font_family(settings().font_family ?? "JetBrains Mono").text_size(12).font_semibold().text_color(g.fg).child(anchor.file))
        .child(div().flex_none().text_size(11).text_color(g.muted).child(anchor.side === "old" ? `${range} (removed)` : range)));
    if (!diff || this.overBudget()) return box.child(div().p(12).text_color(g.muted).child("Loading diff…"));
    if (diff.error) return box.child(div().p(12).text_color(g.del.sign).child(diff.error));
    const { rows, hunks } = diff;
    const window = this.windowFor(key, rows, anchor);
    if (!window) return box.child(div().p(12).text_color(g.selected).child("This anchor doesn't match any change in the diff."));

    const code = v_flex().font_family(settings().font_family ?? "JetBrains Mono").text_size(12);
    const firstChange = rows.slice(window.lo, window.hi + 1).find((r) => r.hunk !== undefined);
    code.child(this.expander(`up-${key}`, window.lo > 0 ? "↑" : null, hunks[firstChange?.hunk]?.header ?? "",
      () => { window.lo = Math.max(0, window.lo - EXPAND_STEP); }, g));

    let shown = 0;
    for (let i = window.lo; i <= window.hi && shown < MAX_ROWS; i++) {
      const row = rows[i];
      if (i > window.lo && jumpsBetween(rows[i - 1], row)) {
        code.child(this.expander(`jump-${key}-${i}`, null, hunks[row.hunk].header, null, g));
      }
      let end = i;
      while (end + 1 <= window.hi && rows[end + 1].gap) end++;
      const run = row.gap ? end - i + 1 : 0;
      const start = i;
      if (run > FOLD_AFTER && !window.open[start] && start !== window.lo && end !== window.hi) {
        code.child(this.expander(`fold-${key}-${start}`, "↕", `${run} unchanged lines`, () => { window.open[start] = true; }, g));
        i = end;
        continue;
      }
      if (this.rowsLeft <= 0 || this.overBudget()) {
        this.deferred = true;
        code.child(div().px(12).py(6).text_color(g.muted).child("Loading…"));
        return box.child(code);
      }
      this.rowsLeft--;
      code.child(this.diffRow(row, anchor, g));
      shown++;
    }
    if (shown >= MAX_ROWS) code.child(div().px(12).py(6).text_color(g.muted).child(`… showing the first ${MAX_ROWS} lines`));
    if (window.hi < rows.length - 1) {
      code.child(this.expander(`down-${key}`, "↓", "", () => { window.hi = Math.min(rows.length - 1, window.hi + EXPAND_STEP); }, g));
    }
    return box.child(code);
  }

  // The rows an anchor shows: its own lines plus CONTEXT on each side, widened by the expanders.
  windowFor(key, rows, anchor) {
    if (this.windows[key]) return this.windows[key];
    let first = -1, last = -1;
    for (let i = 0; i < rows.length; i++) {
      if (inAnchor(rows[i], anchor)) { if (first < 0) first = i; last = i; }
    }
    if (first < 0) return null;
    const window = { lo: Math.max(0, first - CONTEXT), hi: Math.min(rows.length - 1, last + CONTEXT), open: {} };
    this.windows[key] = window;
    return window;
  }

  // GitHub's blue bar: an arrow in the gutter expands, the rest shows the hunk header.
  expander(id, arrow, label, onExpand, g) {
    const bar = h_flex().id(id).h(28).flex_none().items_center().bg(g.hunk.line)
      .child(div().w(91).h_full().flex_none().flex().items_center().justify_center().bg(g.hunk.num).text_color(g.muted).child(arrow ?? ""))
      .child(div().flex_1().min_w(0).px(10).truncate().text_color(g.muted).child(label));
    if (!onExpand) return bar;
    return bar.cursor_pointer().hover((s) => s.opacity(0.8)).on_click((_e, cx) => { onExpand(); cx.notify(); });
  }

  overview(t) {
    const tour = this.tour;
    return v_flex().gap(14)
      .child(div().text_size(15).font_semibold().child("What this change does"))
      .child(TextView.markdown("tour-intent", tour.intent).text_size(13))
      .child(div().text_size(13).font_semibold().pt(4).child("Reading order"))
      .child(v_flex().gap(8).children(tour.reading_order.map((r, i) => h_flex().gap(10).items_start()
        .child(div().w(18).flex_none().text_right().text_color(t.dim).child(`${i + 1}.`))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().font_family(settings().font_family ?? "JetBrains Mono").text_size(12).child(r.file))
          .child(div().text_size(12).text_color(t.muted).child(r.why))))))
      .child(h_flex().gap(6).pt(4).text_size(11).text_color(t.dim)
        .child(`${tour.steps.filter((s) => s.tag === "read_closely").length} to read closely · ${tour.steps.filter((s) => s.tag === "skim").length} to skim · ${tour.concerns.length} concerns`)
        .when(Boolean(tour.author?.agent), (e) => e.child(`· by ${tour.author.agent}`)));
  }

  concerns(t) {
    const list = this.tour.concerns;
    return v_flex().gap(12)
      .child(div().text_size(15).font_semibold().child("Open concerns"))
      .when(!list.length, (e) => e.child(div().text_color(t.dim).child("None.")))
      .children(list.map((c, i) => v_flex().gap(8)
        .child(h_flex().gap(8).items_start().child(div().flex_none().text_color(t.blocked).child("!")).child(div().flex_1().min_w(0).child(TextView.markdown(`concern-${i}`, c.text).text_size(13))))
        .when(Boolean(c.anchor), (e) => e.child(this.anchorView(c.anchor, `concern-${i}`, t)))));
  }

  stepView(step, t) {
    const done = this.progress().done[step.id];
    return v_flex().gap(12)
      .child(h_flex().gap(8).items_center()
        .child(this.tagPill(step, t))
        .when(Boolean(step.hotspot), (e) => e.child(this.pill("★ HOTSPOT", t.blocked, t.blocked + "22")))
        .when(Boolean(done), (e) => e.child(this.pill("✓ REVIEWED", t.done, t.done + "22"))))
      .child(div().text_size(15).font_semibold().child(step.title))
      .child(TextView.markdown(`why-${step.id}`, step.why).text_size(13))
      .when(Boolean(step.check), (e) => e.child(v_flex().gap(4).p(10).rounded(8).border_1().border_color(t.blocked + "66").bg(t.blocked + "14")
        .child(div().text_size(10).font_semibold().text_color(t.blocked).child("CHECK"))
        .child(TextView.markdown(`check-${step.id}`, step.check).text_size(13))))
      .children(step.anchors.map((a, i) => this.anchorView(a, `${step.id}-${i}`, t)));
  }

  footer(t) {
    const list = this.entries(), current = this.progress().current, at = list.findIndex((e) => e.id === current);
    const step = list[at]?.step, done = step && this.progress().done[step.id];
    return h_flex().flex_none().h(46).px(12).gap(8).items_center().border_t(1).border_color(t.border)
      .child(this.button("prev", "← Prev", () => this.move(-1), t))
      .child(this.button("next", "Next →", () => this.move(1), t))
      .child(div().flex_1().text_size(11).text_color(t.dim).child("j/k move · space reviewed + next · f filter"))
      .when(Boolean(step), (e) => e.child(this.button("done", done ? "✓ Reviewed" : "Mark reviewed", () => this.toggleDone(step.id), t, !done)));
  }

  overBudget() {
    if (Date.now() - this.renderStarted <= RENDER_BUDGET_MS) return false;
    this.deferred = true;
    return true;
  }

  render(cx) {
    this.renderStarted = Date.now();
    this.deferred = false;
    this.rowsLeft = this.rowCap ?? FIRST_ROW_CAP;
    const t = theme();
    const root = v_flex().id("pr-tour").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .track_focus(this.handle).on_key_down((e, cx) => this.tour && this.onKey(e, cx))
      .on_mouse_down("left", () => this.handle.focus());
    if (!this.tour) return root.child(v_flex().size_full().items_center().justify_center().p(24).gap(8)
      .child(div().font_semibold().child("Reviewer's tour"))
      .child(div().text_color(t.muted).text_center().child(this.status)));
    const current = this.entries().find((e) => e.id === this.progress().current) ?? this.entries()[0];
    const body = current.id === "overview" ? this.overview(t) : current.id === "concerns" ? this.concerns(t) : this.stepView(current.step, t);
    const page = root
      .child(this.header(t))
      .child(h_flex().flex_1().min_h(0)
        .child(this.sidebar(t))
        .child(v_flex().id(`detail-${current.id}`).flex_1().min_w(0).h_full().overflow_y_scrollbar().p(18).child(body)))
      .child(this.footer(t));
    return page;
  }
}
