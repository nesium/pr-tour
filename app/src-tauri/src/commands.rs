//! What the viewer may ask of the system. Arguments arrive as domain types, so
//! a malformed commit id or path is rejected before any command runs. All slow
//! work is `async` and runs on Tauri's Tokio thread pool, not the main thread.

use crate::types::{BranchName, CommitId, RepoFile, RepoRoot, TourPath};
use crate::{git, locate, validate};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// What the app was started with: `pr-tour [open] [branch] [--repo <path>] [--tour <file>]`.
#[derive(Clone, Default, Serialize)]
pub struct Launch {
    repo: Option<PathBuf>,
    branch: Option<BranchName>,
    tour: Option<TourPath>,
    problem: Option<String>,
}

impl Launch {
    pub fn from_args(args: &[String]) -> Self {
        let mut launch = Launch::default();
        let mut args = args.iter().peekable();
        if args.peek().is_some_and(|a| *a == "open") {
            args.next();
        }
        let mut problems = Vec::new();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--repo" => launch.repo = args.next().map(PathBuf::from),
                "--tour" => match args.next().map(|t| std::path::absolute(t).map_err(|e| e.to_string()).and_then(TourPath::try_from)) {
                    Some(Ok(tour)) => launch.tour = Some(tour),
                    Some(Err(error)) => problems.push(error),
                    None => problems.push("--tour needs a file".into()),
                },
                _ if launch.branch.is_none() => match BranchName::try_from(arg.as_str()) {
                    Ok(branch) => launch.branch = Some(branch),
                    Err(error) => problems.push(error),
                },
                _ => problems.push(format!("unexpected argument {arg}")),
            }
        }
        // Started from a terminal, the working directory is the repository.
        // Started from Finder, it is `/`, which is never what was meant.
        launch.repo = launch.repo.or_else(|| std::env::current_dir().ok().filter(|d| d.parent().is_some()));
        launch.problem = (!problems.is_empty()).then(|| problems.join("; "));
        launch
    }
}

#[derive(Default)]
pub struct TourWatcher(Mutex<Option<RecommendedWatcher>>);

#[derive(Serialize)]
pub struct TourFile {
    text: Option<String>,
    writing: bool,
}

#[derive(Serialize)]
pub struct FileDiff {
    diff: Result<String, String>,
    /// The file at head, for the unchanged lines between hunks. None when it's
    /// binary or deleted at head.
    lines: Option<String>,
}

#[tauri::command]
pub fn launch(launch: State<Launch>) -> Launch {
    launch.inner().clone()
}

#[tauri::command]
pub async fn locate(repo: PathBuf, branch: Option<BranchName>, tour: Option<TourPath>) -> Result<locate::Located, String> {
    locate::locate(&repo, branch, tour).await
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
    let at_head = format!("{head}:{file}");
    let show_args = ["show", "--no-textconv", &at_head];
    let (diff, show) = tokio::join!(git::run(root.as_path(), &diff_args), git::run(root.as_path(), &show_args));
    let lines = show.ok().filter(|s| s.success && !s.stdout.contains(&0)).map(|s| s.text());
    Ok(FileDiff { diff: diff?.into_result(&diff_args), lines })
}

/// Emits `tour-changed` whenever the tour or its lock is written or removed.
/// Replaces the previous watch, so the window follows one tour at a time.
#[tauri::command]
pub fn watch_tour(app: AppHandle, watcher: State<TourWatcher>, path: TourPath) -> Result<(), String> {
    let folder = path.as_path().parent().ok_or("tour has no folder")?.to_owned();
    let names: Vec<_> = [path.as_path(), path.lock().as_path()].iter().filter_map(|p| p.file_name().map(ToOwned::to_owned)).collect();
    let mut next = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        if event.paths.iter().any(|p| p.file_name().is_some_and(|n| names.iter().any(|w| w == n))) {
            let _ = app.emit("tour-changed", ());
        }
    })
    .map_err(|e| e.to_string())?;
    next.watch(&folder, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
    *watcher.0.lock().map_err(|e| e.to_string())? = Some(next);
    Ok(())
}
