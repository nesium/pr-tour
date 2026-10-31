import { shortCommit, type Note, type NoteLines, type Tour } from "./types";

/** Lines of code shown per note; more would bury the request. */
const MAX_CODE_LINES = 20;

/** The noted lines as `number text`, or null when their diff isn't loaded. */
export type CodeOf = (lines: NoteLines) => string[] | null;

export const where = (lines: NoteLines) =>
  `${lines.file}:${lines.start === lines.end ? `L${lines.start}` : `L${lines.start}-${lines.end}`}${lines.side === "old" ? " (removed)" : ""}`;

/**
 * The open notes as a prompt to paste into the author's session: change
 * requests numbered so the agent can answer per note, remarks after them.
 * Notes on an older commit say so, since their lines may have moved.
 */
export function handoffPrompt(tour: Tour, notes: Note[], codeOf: CodeOf): string {
  const titleOf = (note: Note) => tour.steps.find((s) => s.id === note.step)?.title ?? note.step;
  const changes = notes.filter((n) => n.kind === "change");
  const remarks = notes.filter((n) => n.kind === "remark");
  const describe = (note: Note) => {
    const at = note.lines ? ` — ${where(note.lines)}` : "";
    const older = note.head_sha !== tour.head_sha ? ` (lines as of ${shortCommit(note.head_sha)})` : "";
    return `Step "${titleOf(note)}"${at}${older}`;
  };
  const code = (note: Note) => {
    // An older note's lines refer to its own commit, so today's code would be the wrong code.
    const shown = note.lines && note.head_sha === tour.head_sha ? codeOf(note.lines) : null;
    if (!shown?.length) return "";
    const cut = shown.length > MAX_CODE_LINES ? [...shown.slice(0, MAX_CODE_LINES), "…"] : shown;
    return `\n\n   \`\`\`\n${cut.map((l) => `   ${l}`).join("\n")}\n   \`\`\``;
  };
  const indent = (text: string) => text.split("\n").join("\n   ");

  const parts = [
    `Review notes on \`${tour.branch}\` at ${shortCommit(tour.head_sha)} (against \`${tour.base}\`).`,
  ];
  if (changes.length) {
    parts.push(
      "Please work through the change requests. For each, change the code and commit, or explain why it should stay as it is. " +
        'Answer by number, e.g. "1. Fixed in <commit>: …".',
      "## Change requests",
      changes.map((note, i) => `${i + 1}. ${describe(note)}\n   ${indent(note.text)}${code(note)}`).join("\n\n"),
    );
  }
  if (remarks.length) {
    parts.push("## Remarks (no change needed)", remarks.map((note) => `- ${describe(note)}: ${note.text}`).join("\n"));
  }
  return parts.join("\n\n") + "\n";
}
