import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, theme, props, run, closeOverlay, notify } from "herdr";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const tourFileName = (branch) => `${branch.replaceAll("/", "__")}.json`;
// Keeps the pane open after a failure so the error can be read; on success it closes by itself.
const KEEP_ON_FAILURE = 'pr="$1"; shift; "$pr" "$@" || { status=$?; printf "\\npr-tour failed (exit %s). Press Enter to close." "$status"; read _; exit "$status"; }';

// Opens the tour of the focused terminal's branch: the existing Tour tab if there is
// one, else a new one, and starts writing the tour when there is none yet.
export default class PrTourOpen extends View {
  init(_props, cx) {
    const f = focused(), pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    this.from = { cwd: pane?.cwd || f?.cwd, space: f?.space };
    this.message = "Opening the tour…";
    cx.spawn(async (cx) => {
      try {
        await this.open();
      } catch (e) {
        notify({ title: "PR tour", body: String(e.message ?? e), level: "error" });
      } finally {
        closeOverlay(props().overlay);
      }
      cx.notify();
    });
  }

  async open() {
    const { cwd, space } = this.from;
    if (!cwd) throw new Error("Focus a terminal in a git repository first.");
    const git = async (...args) => {
      const r = await exec("git", [...READ, ...args], { cwd });
      if (r.code !== 0) throw new Error(r.stderr.trim() || `git ${args[0]} failed`);
      return r.stdout.trim();
    };
    const root = await git("rev-parse", "--show-toplevel").catch(() => { throw new Error(`Not a git repository: ${cwd}`); });
    const branch = await git("symbolic-ref", "--short", "-q", "HEAD").catch(() => "");
    if (!branch) throw new Error("Detached HEAD: check out the branch to tour.");
    const name = `Tour · ${branch}`;

    for (const s of spaces()) {
      const tab = s.tabs.find((t) => t.name === name);
      if (tab) {
        if (!s.active) run("space.select", { id: s.id });
        run("tab.select", { id: tab.id });
        return;
      }
    }

    const folder = `${await git("rev-parse", "--path-format=absolute", "--git-common-dir")}/pr-tours`;
    const tour = `${folder}/${tourFileName(branch)}`;
    const [existing, writing] = await Promise.all([readTextFile(tour), readTextFile(tour.replace(/\.json$/, ".lock"))]);

    run("tab.new", { name, space, mod: "pr-tour", props: { repo: root, branch } });
    // tab.new makes the tab in that space but doesn't show a space that isn't on screen.
    const home = spaces().find((s) => s.tabs.some((t) => t.name === name));
    const tab = home?.tabs.find((t) => t.name === name);
    if (home && !home.active) run("space.select", { id: home.id });
    if (tab && !tab.active) run("tab.select", { id: tab.id });
    if (existing !== null || writing !== null) return;

    const which = await exec("which", ["pr-tour"]);
    if (which.code !== 0) throw new Error("pr-tour is not installed: run install.sh from the pr-tour checkout.");
    const viewer = tab && panes().find((p) => p.tab === tab.id && p.mod === "pr-tour");
    if (!viewer) throw new Error("The Tour tab didn't open, so the tour wasn't started.");
    run("pane.split", { pane: viewer.pane, direction: "down", argv: ["/bin/sh", "-c", KEEP_ON_FAILURE, "sh", which.stdout.trim(), "--repo", root, branch] });
  }

  render() {
    const t = theme();
    return v_flex().size_full().justify_center().px(16).bg(t.popover).text_color(t.muted).text_size(13).child(div().child(this.message));
  }
}
