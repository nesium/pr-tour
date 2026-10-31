//! Finds the interactive Claude Code session that knows a branch best, from
//! the transcripts under `~/.claude/projects/<repo path with non-alphanumerics as ->/`.

use super::Failure;
use crate::types::{BranchName, RepoRoot, SessionId};
use chrono::{DateTime, Local};
use serde_json::Value;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

const EDIT_TOOLS: &[&str] = &["Edit", "Write", "MultiEdit", "NotebookEdit"];

#[derive(Clone, Debug)]
pub struct Session {
    pub id: SessionId,
    pub last_active: DateTime<Local>,
    pub edits: usize,
    pub first_prompt: Option<String>,
}

pub fn projects_folder() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".claude").join("projects"))
}

fn transcripts_folder(root: &RepoRoot) -> Option<PathBuf> {
    let name: String = root.to_string().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    Some(projects_folder()?.join(name))
}

/// Prefers sessions that edited files in the repo while on the branch, newest
/// first; a session that only ran with the branch checked out comes after
/// them. Sessions whose latest message came from a headless run (`claude -p`,
/// recorded as entrypoint sdk-cli) are skipped: those are earlier tours and
/// their forks. Blocking: reads every transcript of the repository.
pub fn find(root: &RepoRoot, branch: &BranchName, wanted: Option<&SessionId>) -> Result<Option<Session>, Failure> {
    let Some(folder) = transcripts_folder(root).filter(|f| f.is_dir()) else {
        return Ok(None);
    };
    let entries = std::fs::read_dir(&folder).map_err(|e| Failure(format!("cannot read {}: {e}", folder.display())))?;
    let mut best: Option<Session> = None;
    for path in entries.filter_map(|e| e.ok().map(|e| e.path())) {
        if path.extension().is_none_or(|e| e != "jsonl") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()).and_then(|s| SessionId::try_from(s).ok()) else {
            continue;
        };
        if wanted.is_some_and(|w| *w != id) {
            continue;
        }
        let summary = summarize(&path, root, branch);
        let Some(last) = summary.last else { continue };
        let found = Session {
            id,
            last_active: last_active(&last, &path),
            edits: summary.edits,
            first_prompt: summary.first_prompt,
        };
        if wanted.is_some() {
            return Ok(Some(found));
        }
        if !summary.on_branch || last.get("entrypoint").and_then(Value::as_str) != Some("cli") {
            continue;
        }
        let rank = |s: &Session| (s.edits > 0, s.last_active);
        if best.as_ref().is_none_or(|b| rank(&found) > rank(b)) {
            best = Some(found);
        }
    }
    match wanted {
        Some(wanted) => Err(Failure(format!("session {wanted} not found under {}", folder.display()))),
        None => Ok(best),
    }
}

struct Summary {
    on_branch: bool,
    edits: usize,
    last: Option<Value>,
    first_prompt: Option<String>,
}

fn summarize(path: &Path, root: &RepoRoot, branch: &BranchName) -> Summary {
    let mut summary = Summary { on_branch: false, edits: 0, last: None, first_prompt: None };
    let Ok(file) = File::open(path) else { return summary };
    for line in BufReader::new(file).split(b'\n').map_while(Result::ok) {
        let Ok(record) = serde_json::from_slice::<Value>(&line) else { continue };
        let kind = record.get("type").and_then(Value::as_str);
        let on = record.get("gitBranch").and_then(Value::as_str).filter(|b| !b.is_empty());
        let (Some(kind @ ("user" | "assistant")), Some(on)) = (kind, on) else { continue };
        if on == branch.as_str() {
            summary.on_branch = true;
            summary.edits += edits_in(&record, root);
        }
        if summary.first_prompt.is_none() && kind == "user" && !record.get("isMeta").is_some_and(truthy) {
            if let Some(content) = record.pointer("/message/content").and_then(Value::as_str).filter(|c| !c.starts_with('<')) {
                summary.first_prompt = Some(content.to_owned());
            }
        }
        summary.last = Some(record);
    }
    summary
}

/// How many file edits inside the repo one assistant message made.
fn edits_in(record: &Value, root: &RepoRoot) -> usize {
    let Some(content) = record.pointer("/message/content").and_then(Value::as_array) else { return 0 };
    if record["type"] != "assistant" {
        return 0;
    }
    let inside = format!("{root}/");
    content
        .iter()
        .filter(|item| item["type"] == "tool_use" && item["name"].as_str().is_some_and(|n| EDIT_TOOLS.contains(&n)))
        .filter(|item| {
            let input = &item["input"];
            let path = input["file_path"].as_str().filter(|p| !p.is_empty()).or(input["notebook_path"].as_str()).unwrap_or("");
            path.starts_with(&inside)
        })
        .count()
}

/// The last message's time, not the file's: resuming a session (as a fork does) touches the file.
fn last_active(last: &Value, path: &Path) -> DateTime<Local> {
    let stamped = last.get("timestamp").and_then(Value::as_str).and_then(|t| DateTime::parse_from_rfc3339(t).ok());
    match stamped {
        Some(time) => time.with_timezone(&Local),
        None => path.metadata().and_then(|m| m.modified()).map_or_else(|_| Local::now(), DateTime::<Local>::from),
    }
}

fn truthy(value: &Value) -> bool {
    !matches!(value, Value::Null | Value::Bool(false)) && value != "" && value != 0
}

/// One line on who writes the tour, for the log and `--dry-run`.
pub fn describe(session: Option<&Session>) -> String {
    let Some(session) = session else {
        return "a fresh Claude Code session (no interactive session on this branch was found)".into();
    };
    let when = session.last_active.format("%Y-%m-%d %H:%M");
    let topic = match session.first_prompt.as_deref().map(str::trim).and_then(|p| p.lines().next()) {
        Some(line) => line.chars().take(80).collect(),
        None => "?".to_owned(),
    };
    let edits = match session.edits {
        0 => "no edits on this branch".to_owned(),
        n => format!("{n} edits in the repo on this branch"),
    };
    format!("a fork of session {} (last active {when}; {edits}; started with: {})", session.id, py_repr(&topic))
}

/// Python's repr of a string, as the generator has always printed the topic.
fn py_repr(text: &str) -> String {
    let quote = if text.contains('\'') && !text.contains('"') { '"' } else { '\'' };
    let mut out = String::from(quote);
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c == quote => {
                out.push('\\');
                out.push(c);
            }
            c => out.push(c),
        }
    }
    out.push(quote);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn counts_only_edits_inside_the_repo() {
        let root = RepoRoot::try_from(PathBuf::from("/r/app")).unwrap();
        let record = json!({"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": "Edit", "input": {"file_path": "/r/app/a.rs"}},
            {"type": "tool_use", "name": "Write", "input": {"file_path": "/r/application/b.rs"}},
            {"type": "tool_use", "name": "Read", "input": {"file_path": "/r/app/c.rs"}},
            {"type": "tool_use", "name": "NotebookEdit", "input": {"notebook_path": "/r/app/n.ipynb"}},
        ]}});
        assert_eq!(edits_in(&record, &root), 2);
    }

    #[test]
    fn repr_matches_python() {
        assert_eq!(py_repr("plain"), "'plain'");
        assert_eq!(py_repr("it's"), "\"it's\"");
        assert_eq!(py_repr("both ' and \""), "'both \\' and \"'");
    }
}
