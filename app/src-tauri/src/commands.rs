//! What the viewer may ask of the system. Arguments arrive as domain types, so
//! a malformed commit id or path is rejected before any command runs. All slow
//! work is `async` and runs on Tauri's Tokio thread pool, not the main thread.

use crate::generate::ask::{self, Answers, Question};
use crate::types::{BranchName, CommitId, RepoFile, RepoRoot, StepId, TourPath};
use crate::windows::{self, GenerationState, OpenRequest, WindowContent, WindowLabel, Windows};
use crate::stat::{self, FileStat};
use crate::review::{self, Review, ReviewChange};
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
pub async fn validate_tour(root: RepoRoot, path: TourPath) -> Vec<validate::Problem> {
    match validate::validate_file(path.as_path(), &root).await {
        Ok((_, problems)) => problems,
        Err(message) => vec![validate::Problem { kind: validate::ProblemKind::Tour, message }],
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
pub fn start_generation(app: AppHandle, window: Window, force: bool) -> Result<(), String> {
    windows::start_generation(&app, &WindowLabel::of(&window), force)
}

#[tauri::command]
pub fn cancel_generation(app: AppHandle, window: Window) {
    windows::cancel_generation(&app, &WindowLabel::of(&window));
}

/// Opens the tour of the branch checked out in `repo`, chosen in the start window.
#[tauri::command]
pub async fn open_repo(app: AppHandle, repo: PathBuf) -> Result<(), String> {
    windows::open(&app, OpenRequest { repo, branch: None, base: None, tour: None, generate: false }).await
}

/// Every file the tour's commits change, with its size. Renames count as a
/// removal and an addition, as the tour's per-file diffs show them.
#[tauri::command]
pub async fn diff_stat(root: RepoRoot, base: CommitId, head: CommitId) -> Result<Vec<FileStat>, String> {
    let args = ["diff", "--numstat", "-z", "--no-renames", "--no-ext-diff", base.as_str(), head.as_str()];
    Ok(stat::parse_numstat(&git::text(root.as_path(), &args).await?))
}

/// The questions asked about this window's tour, with their answers.
#[tauri::command]
pub async fn read_answers(window: Window, windows: State<'_, Windows>) -> Result<Answers, String> {
    let located = windows.located(&WindowLabel::of(&window)).ok_or("this window has no tour")?;
    Ok(ask::read(&located.path.answers()).await)
}

/// Records the question as pending and returns; the answer arrives in the
/// answers file, which the window watches.
#[tauri::command]
pub async fn ask(window: Window, windows: State<'_, Windows>, step: StepId, question: String) -> Result<(), String> {
    let located = windows.located(&WindowLabel::of(&window)).ok_or("this window has no tour")?;
    let question = Question { root: located.root, branch: located.branch, tour: located.path, step, question };
    let asked = ask::prepare(question, true).await.map_err(|e| e.to_string())?;
    // The outcome, failures included, is written to the answers file.
    tauri::async_runtime::spawn(async move {
        let _ = asked.answer().await;
    });
    Ok(())
}

/// The reviewer's notes on this window's branch.
#[tauri::command]
pub async fn read_review(window: Window, windows: State<'_, Windows>) -> Result<Review, String> {
    let located = windows.located(&WindowLabel::of(&window)).ok_or("this window has no tour")?;
    Ok(review::read(&located.path.review()).await)
}

#[tauri::command]
pub async fn update_review(window: Window, windows: State<'_, Windows>, change: ReviewChange) -> Result<(), String> {
    let located = windows.located(&WindowLabel::of(&window)).ok_or("this window has no tour")?;
    review::change(&located.path.review(), change).await.map_err(|e| e.to_string())
}

/// A commit on the branch since the tour: its id and subject.
#[derive(Serialize)]
pub struct Commit {
    sha: CommitId,
    subject: String,
}

/// What happened on the branch between two commits.
#[derive(Serialize)]
pub struct Since {
    /// False when `from` is no longer in the branch's history (a rebase or
    /// force-push): then there is no clean "what changed since".
    linear: bool,
    commits: Vec<Commit>,
    files: Vec<FileStat>,
}

#[tauri::command]
pub async fn branch_since(root: RepoRoot, from: CommitId, to: CommitId) -> Result<Since, String> {
    let at = root.as_path();
    let range = format!("{from}..{to}");
    let ancestor = ["merge-base", "--is-ancestor", from.as_str(), to.as_str()];
    let log = ["log", "--format=%H%x00%s", "--reverse", range.as_str()];
    let stat = ["diff", "--numstat", "-z", "--no-renames", "--no-ext-diff", from.as_str(), to.as_str()];
    let (ancestor, log, stat) = tokio::join!(git::run(at, &ancestor), git::text(at, &log), git::text(at, &stat));
    let commits = log?
        .lines()
        .filter_map(|line| {
            let (sha, subject) = line.split_once('\0')?;
            Some(Commit { sha: CommitId::try_from(sha).ok()?, subject: subject.to_owned() })
        })
        .collect();
    Ok(Since { linear: ancestor?.success, commits, files: stat::parse_numstat(&stat?) })
}

/// Whether the `pr-tour` command and the Claude Code skill are installed.
#[tauri::command]
pub async fn setup_status() -> Result<crate::install::Setup, String> {
    tauri::async_runtime::spawn_blocking(crate::install::status).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn install_setup() -> Result<crate::install::Setup, String> {
    tauri::async_runtime::spawn_blocking(crate::install::install).await.map_err(|e| e.to_string())?
}
