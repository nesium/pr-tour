//! One window per tour. Opening a tour that already has a window focuses it.
//! Each window owns the watcher on its tour and, while one runs, the task
//! writing it; both end when the window closes.

use crate::generate::{self, AgentChoice, Outcome};
use crate::locate::{self, Located};
use crate::types::{BranchArg, BranchName, TourPath};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fmt;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// A window's Tauri label: `tour-<hash of the tour path>`, or `start`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct WindowLabel(String);

impl WindowLabel {
    pub fn start() -> Self {
        WindowLabel("start".into())
    }

    fn for_tour(tour: &TourPath) -> Self {
        let mut hasher = DefaultHasher::new();
        tour.hash(&mut hasher);
        WindowLabel(format!("tour-{:016x}", hasher.finish()))
    }

    pub fn of(window: &tauri::Window) -> Self {
        WindowLabel(window.label().to_owned())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for WindowLabel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// `pr-tour [open] [[base...]branch] [--base <branch>] [--repo <path>] [--tour <file>] [--generate]`.
/// Relative paths are taken from `cwd`: a second launch forwards its own.
#[derive(Clone, Debug)]
pub struct OpenRequest {
    pub repo: PathBuf,
    pub branch: Option<BranchName>,
    /// The base to write the tour against; without one, the tour's own, else the default.
    pub base: Option<BranchName>,
    pub tour: Option<TourPath>,
    /// Start writing the tour if there is none, or it has another base than the
    /// one asked for, and none is being written.
    pub generate: bool,
}

impl OpenRequest {
    /// None when nothing names a repository, as when started from Finder.
    pub fn from_args(args: &[String], cwd: &Path) -> Result<Option<Self>, String> {
        let mut repo = None;
        let mut branch = None;
        let mut base = None;
        let mut tour = None;
        let mut generate = false;
        let mut args = args.iter().skip_while(|a| *a == "open");
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--repo" => repo = Some(cwd.join(args.next().ok_or("--repo needs a path")?)),
                "--tour" => tour = Some(TourPath::try_from(cwd.join(args.next().ok_or("--tour needs a file")?))?),
                "--base" => base = Some(BranchName::try_from(args.next().ok_or("--base needs a branch")?.as_str())?),
                "--generate" => generate = true,
                // macOS adds -psn_… when Finder starts an app.
                flag if flag.starts_with('-') => {}
                _ if branch.is_none() => branch = Some(BranchArg::try_from(arg.as_str())?),
                _ => return Err(format!("unexpected argument {arg}")),
            }
        }
        let (branch, base) = match branch {
            Some(named) => named.with_base(base).map(|(branch, base)| (Some(branch), base))?,
            None => (None, base),
        };
        // `/` is where Finder starts apps; it is never the repository meant.
        let repo = repo.or_else(|| cwd.parent().map(|_| cwd.to_owned()));
        Ok(repo.map(|repo| OpenRequest { repo, branch, base, tour, generate }))
    }
}

#[derive(Clone, Default, Serialize)]
pub struct GenerationState {
    running: bool,
    lines: Vec<String>,
    failure: Option<String>,
}

struct TourWindow {
    located: Located,
    /// The base the last open asked for, used when writing the tour.
    base: Option<BranchName>,
    _watcher: RecommendedWatcher,
    generation: GenerationState,
    task: Option<JoinHandle<()>>,
}

#[derive(Default)]
pub struct Windows {
    tours: Mutex<HashMap<WindowLabel, TourWindow>>,
    start_message: Mutex<Option<String>>,
    /// One open at a time: between finding no window and creating one, another
    /// open of the same tour would create a second.
    opening: tokio::sync::Mutex<()>,
}

/// What a window shows, asked by its webview when it loads.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WindowContent {
    Tour { located: Located },
    Start { message: Option<String> },
}

impl Windows {
    pub fn content(&self, label: &WindowLabel) -> WindowContent {
        if let Some(window) = self.tours.lock().unwrap().get(label) {
            return WindowContent::Tour { located: window.located.clone() };
        }
        WindowContent::Start { message: self.start_message.lock().unwrap().clone() }
    }

    /// The tour a tour window shows.
    pub fn located(&self, label: &WindowLabel) -> Option<Located> {
        self.tours.lock().unwrap().get(label).map(|w| w.located.clone())
    }

    pub fn generation(&self, label: &WindowLabel) -> GenerationState {
        self.tours.lock().unwrap().get(label).map(|w| w.generation.clone()).unwrap_or_default()
    }

    /// Forgets a closed window, which stops its watcher and any generation.
    pub fn closed(&self, label: &WindowLabel) {
        if let Some(window) = self.tours.lock().unwrap().remove(label) {
            if let Some(task) = window.task {
                task.abort();
            }
        }
    }
}

/// Opens the request's tour, or the start window with the reason it couldn't.
pub async fn open_or_explain(app: &AppHandle, request: Option<OpenRequest>) {
    let Some(request) = request else {
        return show_start(app, None);
    };
    if let Err(error) = open(app, request).await {
        show_start(app, Some(error));
    }
}

pub async fn open(app: &AppHandle, request: OpenRequest) -> Result<(), String> {
    let windows = app.state::<Windows>();
    let _opening = windows.opening.lock().await;
    let located = locate::locate(&request.repo, request.branch, request.tour).await?;
    let label = WindowLabel::for_tour(&located.path);
    let title = format!("Tour · {}", located.branch);
    let writing = located.lock.as_path().exists();
    let missing = !located.path.as_path().exists();
    let other_base = request.base.as_ref().is_some_and(|base| tour_base(&located.path).as_ref() != Some(base));
    if let Some(window) = app.get_webview_window(label.as_str()) {
        if let Some(entry) = windows.tours.lock().unwrap().get_mut(&label) {
            entry.base = request.base.clone().or(entry.base.take());
        }
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        let watcher = watch(app, &label, &located.path)?;
        let entry = TourWindow { located, base: request.base.clone(), _watcher: watcher, generation: GenerationState::default(), task: None };
        app.state::<Windows>().tours.lock().unwrap().insert(label.clone(), entry);
        WebviewWindowBuilder::new(app, label.as_str(), WebviewUrl::App("index.html".into()))
            .title(title)
            .inner_size(1240.0, 840.0)
            .min_inner_size(720.0, 420.0)
            .build()
            .map_err(|e| e.to_string())?;
    }
    if let Some(start) = app.get_webview_window(WindowLabel::start().as_str()) {
        let _ = start.close();
    }
    if request.generate && !writing && (missing || other_base) {
        start_generation(app, &label, false)?;
    }
    Ok(())
}

/// The base branch a written tour names.
fn tour_base(tour: &TourPath) -> Option<BranchName> {
    let text = std::fs::read_to_string(tour.as_path()).ok()?;
    let tour: serde_json::Value = serde_json::from_str(&text).ok()?;
    BranchName::try_from(tour["base"].as_str()?).ok()
}

pub fn show_start(app: &AppHandle, message: Option<String>) {
    *app.state::<Windows>().start_message.lock().unwrap() = message;
    let label = WindowLabel::start();
    if let Some(window) = app.get_webview_window(label.as_str()) {
        let _ = window.emit_to(label.as_str(), "start-changed", ());
        let _ = window.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, label.as_str(), WebviewUrl::App("index.html".into()))
        .title("PR Tour")
        .inner_size(520.0, 360.0)
        .resizable(false)
        .build();
    if let Err(error) = built {
        eprintln!("pr-tour: cannot open a window: {error}");
    }
}

/// Emits `tour-changed` to the window whenever its tour or lock is written or
/// removed, and `answers-changed` or `review-changed` whenever its answers or
/// review file is.
fn watch(app: &AppHandle, label: &WindowLabel, tour: &TourPath) -> Result<RecommendedWatcher, String> {
    let folder = tour.as_path().parent().ok_or("tour has no folder")?.to_owned();
    let name = |path: &Path| path.file_name().map(ToOwned::to_owned);
    let tour_names: Vec<_> = [name(tour.as_path()), name(tour.lock().as_path())].into_iter().flatten().collect();
    let answers_name = name(tour.answers().as_path());
    let review_name = name(tour.review().as_path());
    let (app, label) = (app.clone(), label.clone());
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        let names: Vec<_> = event.paths.iter().filter_map(|p| p.file_name()).collect();
        if names.iter().any(|n| tour_names.iter().any(|w| w == n)) {
            let _ = app.emit_to(label.as_str(), "tour-changed", ());
        }
        if names.iter().any(|n| answers_name.as_deref() == Some(*n)) {
            let _ = app.emit_to(label.as_str(), "answers-changed", ());
        }
        if names.iter().any(|n| review_name.as_deref() == Some(*n)) {
            let _ = app.emit_to(label.as_str(), "review-changed", ());
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(&folder, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
    Ok(watcher)
}

/// Writes the window's tour. `force` rewrites one that already covers the
/// branch's commit, e.g. to cover changes it left out.
pub fn start_generation(app: &AppHandle, label: &WindowLabel, force: bool) -> Result<(), String> {
    let windows = app.state::<Windows>();
    let mut tours = windows.tours.lock().unwrap();
    let window = tours.get_mut(label).ok_or("this window has no tour")?;
    if window.generation.running {
        return Ok(());
    }
    let request = generate::Request {
        repo: window.located.root.as_path().to_owned(),
        branch: Some(window.located.branch.clone()),
        base: window.base.clone(),
        agent: AgentChoice::Newest,
        force,
        output: Some(window.located.path.clone()),
    };
    window.generation = GenerationState { running: true, lines: vec!["Looking for the session that knows this branch…".into()], failure: None };
    publish(app, label, &window.generation);
    let (app, label) = (app.clone(), label.clone());
    window.task = Some(tauri::async_runtime::spawn(async move {
        let result = generate::generate(&request, |line| update(&app, &label, |state| state.lines.push(line))).await;
        update(&app, &label, |state| {
            state.running = false;
            match result {
                Ok(Outcome::Written { summary, .. }) => state.lines.push(format!("Written: {summary}")),
                Ok(Outcome::UpToDate { .. }) => state.lines.push("The tour already covers this commit.".into()),
                Err(failure) => state.failure = Some(failure.to_string()),
            }
        });
    }));
    Ok(())
}

pub fn cancel_generation(app: &AppHandle, label: &WindowLabel) {
    let task = app.state::<Windows>().tours.lock().unwrap().get_mut(label).and_then(|w| w.task.take());
    if let Some(task) = task {
        task.abort();
        update(app, label, |state| {
            state.running = false;
            state.lines.push("Stopped.".into());
        });
    }
}

fn update(app: &AppHandle, label: &WindowLabel, change: impl FnOnce(&mut GenerationState)) {
    let windows = app.state::<Windows>();
    let mut tours = windows.tours.lock().unwrap();
    if let Some(window) = tours.get_mut(label) {
        change(&mut window.generation);
        publish(app, label, &window.generation);
    }
}

fn publish(app: &AppHandle, label: &WindowLabel, state: &GenerationState) {
    let _ = app.emit_to(label.as_str(), "generation", state);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn resolves_relative_paths_against_the_callers_folder() {
        let request = OpenRequest::from_args(&args(&["open", "feat/x", "--repo", "sub", "--generate"]), Path::new("/work")).unwrap().unwrap();
        assert_eq!(request.repo, PathBuf::from("/work/sub"));
        assert_eq!(request.branch.unwrap().as_str(), "feat/x");
        assert!(request.generate);
    }

    #[test]
    fn the_base_comes_from_a_range_or_the_flag() {
        let open = |list: &[&str]| OpenRequest::from_args(&args(list), Path::new("/work")).map(|r| r.unwrap());
        let ranged = open(&["open", "main...feat/x"]).unwrap();
        assert_eq!((ranged.base.unwrap().as_str(), ranged.branch.unwrap().as_str()), ("main", "feat/x"));
        assert_eq!(open(&["open", "--base", "develop"]).unwrap().base.unwrap().as_str(), "develop");
        assert!(open(&["open", "main...feat/x", "--base", "develop"]).is_err());
    }

    #[test]
    fn finder_launches_name_no_repository() {
        assert!(OpenRequest::from_args(&args(&["-psn_0_12345"]), Path::new("/")).unwrap().is_none());
    }

    #[test]
    fn the_same_tour_gets_the_same_window() {
        let tour = |p: &str| TourPath::try_from(PathBuf::from(p)).unwrap();
        assert_eq!(WindowLabel::for_tour(&tour("/r/.git/pr-tours/a.json")), WindowLabel::for_tour(&tour("/r/.git/pr-tours/a.json")));
        assert_ne!(WindowLabel::for_tour(&tour("/r/.git/pr-tours/a.json")), WindowLabel::for_tour(&tour("/r/.git/pr-tours/b.json")));
    }
}
