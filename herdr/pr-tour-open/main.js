import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { panes, focused, exec, theme, props, closeOverlay, notify } from "herdr";

// Opens the PR Tour app on the focused terminal's branch. The app brings an open
// tour to the front, and starts writing the tour when there is none yet.
export default class PrTourOpen extends View {
  init(_props, cx) {
    const f = focused(), pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    const cwd = pane?.cwd || f?.cwd;
    cx.spawn(async (cx) => {
      try {
        if (!cwd) throw new Error("Focus a terminal in a git repository first.");
        const which = await exec("which", ["pr-tour"]);
        if (which.code !== 0) throw new Error("pr-tour is not installed: run install.sh from the pr-tour checkout.");
        const opened = await exec(which.stdout.trim(), ["open", "--repo", cwd, "--generate"], { cwd });
        if (opened.code !== 0) throw new Error(opened.stderr.trim() || "pr-tour open failed");
      } catch (e) {
        notify({ title: "PR tour", body: String(e.message ?? e), level: "error" });
      } finally {
        closeOverlay(props().overlay);
      }
      cx.notify();
    });
  }

  render() {
    const t = theme();
    return v_flex().size_full().justify_center().px(16).bg(t.popover).text_color(t.muted).text_size(13).child(div().child("Opening the tour…"));
  }
}
