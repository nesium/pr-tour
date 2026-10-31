//! What the viewer may ask of the system. Arguments arrive as domain types, so
//! a malformed commit id or path is rejected before any command runs. All slow
//! work is `async` and runs on Tauri's Tokio thread pool, not the main thread.

use crate::types::{BranchName, CommitId, RepoFile, RepoRoot, TourPath};
use crate::windows::{self, GenerationState, OpenRequest, WindowContent, WindowLabel, Windows};
use crate::{git, validate};
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, State, Window};

#[derive(Serialize)]
pub struct TourFile {
    text: Option<String>,
    writing: bool,
}

#[derive(Serialize)]
pub struct FileDiff {
    diff: Result<String, String>,
    /// The file at head, for the unchanged lines between hunks and highlighting.
    /// None when it's binary or deleted at head.
    lines: Option<String>,
    /// The file at base, for highlighting removed lines. None when it's binary
    /// or added by the branch.
    base_lines: Option<String>,
}

#[tauri::command]
pub async fn read_tour(path: TourPath) -> TourFile {
    let (text, writing) = tokio::join!(tokio::fs::read_to_string(&path), tokio::fs::try_exists(path.lock()));
    TourFile { text: text.ok(), writing: writing.unwrap_or(false) }
}

#[tauri::command]
pub async fn validate_tour(root: RepoRoot, path: TourPath) -> Vec<String> {
    match validate::validate_file(path.as_path(), &root).await {
        Ok((_, problems)) => problems,
        Err(error) => vec![error],
    }
}

/// The commit a branch points at now, to tell when a tour has gone stale.
#[tauri::command]
pub async fn branch_tip(root: RepoRoot, branch: BranchName) -> Option<CommitId> {
    let commit = format!("{branch}^{{commit}}");
    let output = git::run(root.as_path(), &["rev-parse", "--verify", "-q", &commit]).await.ok()?;
    output.success.then(|| CommitId::try_from(output.text().trim()).ok()).flatten()
}

#[tauri::command]
pub async fn file_diff(root: RepoRoot, base: CommitId, head: CommitId, file: RepoFile) -> Result<FileDiff, String> {
    let diff_args = ["diff", "--no-ext-diff", "--no-color", base.as_str(), head.as_str(), "--", file.as_str()];
    let (at_head, at_base) = (format!("{head}:{file}"), format!("{base}:{file}"));
    let (show_head, show_base) = (["show", "--no-textconv", &at_head], ["show", "--no-textconv", &at_base]);
    let (diff, head_text, base_text) = tokio::join!(
        git::run(root.as_path(), &diff_args),
        git::run(root.as_path(), &show_head),
        git::run(root.as_path(), &show_base),
    );
    let text = |shown: Result<git::Output, String>| shown.ok().filter(|s| s.success && !s.stdout.contains(&0)).map(|s| s.text());
    Ok(FileDiff { diff: diff?.into_result(&diff_args), lines: text(head_text), base_lines: text(base_text) })
}

#[tauri::command]
pub fn window_content(window: Window, windows: State<Windows>) -> WindowContent {
    windows.content(&WindowLabel::of(&window))
}

#[tauri::command]
pub fn generation_state(window: Window, windows: State<Windows>) -> GenerationState {
    windows.generation(&WindowLabel::of(&window))
}

#[tauri::command]
pub fn start_generation(app: AppHandle, window: Window) -> Result<(), String> {
    windows::start_generation(&app, &WindowLabel::of(&window))
}

#[tauri::command]
pub fn cancel_generation(app: AppHandle, window: Window) {
    windows::cancel_generation(&app, &WindowLabel::of(&window));
}

/// Opens one file of this window's tour in a window of its own.
#[tauri::command]
pub fn open_file(app: AppHandle, window: Window, file: RepoFile) -> Result<(), String> {
    windows::open_file(&app, &WindowLabel::of(&window), file)
}

/// Opens the tour of the branch checked out in `repo`, chosen in the start window.
#[tauri::command]
pub async fn open_repo(app: AppHandle, repo: PathBuf) -> Result<(), String> {
    windows::open(&app, OpenRequest { repo, branch: None, tour: None, generate: false }).await
}
