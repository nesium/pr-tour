//! Writes a reviewer's tour of a branch without an open agent session.
//!
//! It forks the newest interactive Claude Code session that worked on the
//! branch, so the tour is written with that session's knowledge while the
//! session itself stays untouched. Without such a session it starts a fresh
//! one. The agent can only read; this module fills in the branch facts,
//! validates the tour against the real diff and writes it.

pub mod ask;
mod facts;
pub(crate) mod lock;
mod prompt;
mod sessions;

use crate::types::{BranchArg, BranchName, CommitId, RepoRoot, SessionId, TourPath};
use crate::validate;
use facts::Facts;
use prompt::{Agent, Reply};
use serde_json::{json, Value};
use sessions::Session;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

const TIMEOUT: Duration = Duration::from_secs(20 * 60);

#[derive(Debug)]
pub struct Failure(pub String);

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Failure(message)
    }
}

impl From<&str> for Failure {
    fn from(message: &str) -> Self {
        Failure(message.to_owned())
    }
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Clone, Debug, Default)]
pub enum AgentChoice {
    /// Fork the session that knows the branch best, else start fresh.
    #[default]
    Newest,
    Fresh,
    Session(SessionId),
}

#[derive(Clone, Debug)]
pub struct Request {
    pub repo: PathBuf,
    pub branch: Option<BranchName>,
    pub base: Option<BranchName>,
    pub agent: AgentChoice,
    pub force: bool,
    pub output: Option<TourPath>,
}

/// Everything decided before the agent runs; `--dry-run` shows it and stops.
pub struct Plan {
    pub facts: Facts,
    pub session: Option<Session>,
    pub prompt: String,
    pub argv: Vec<String>,
    pub up_to_date: bool,
}

pub enum Outcome {
    Written { path: TourPath, summary: String },
    UpToDate { path: TourPath, head: CommitId },
}

pub async fn plan(request: &Request) -> Result<Plan, Failure> {
    let mut facts = facts::resolve(&request.repo, request.branch.clone(), request.base.clone()).await?;
    if let Some(output) = &request.output {
        facts.tour_path = output.clone();
    }
    let existing = tokio::fs::read_to_string(&facts.tour_path).await.ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
    // A rewrite keeps the base the tour was written against, unless told otherwise.
    let existing_base = existing.as_ref().and_then(|t| t["base"].as_str()).and_then(|b| BranchName::try_from(b).ok());
    if let Some(base) = existing_base.filter(|b| request.base.is_none() && *b != facts.base) {
        let tour_path = facts.tour_path.clone();
        facts = facts::resolve(&request.repo, Some(facts.branch.clone()), Some(base)).await?;
        facts.tour_path = tour_path;
    }
    let session = match &request.agent {
        AgentChoice::Fresh => None,
        choice => {
            let (root, branch) = (facts.root.clone(), facts.branch.clone());
            let wanted = match choice {
                AgentChoice::Session(id) => Some(id.clone()),
                _ => None,
            };
            tokio::task::spawn_blocking(move || sessions::find(&root, &branch, wanted.as_ref()))
                .await
                .map_err(|e| Failure(e.to_string()))??
        }
    };
    let prompt = prompt::build(&facts, session.is_some()).await?;
    let argv = prompt::claude_argv(session.as_ref().map_or(Agent::Fresh, |s| Agent::Fork(&s.id)), Reply::Tour)?;
    let covers = |key: &str, sha: &CommitId| existing.as_ref().is_some_and(|t| t[key] == sha.as_str());
    let up_to_date = covers("head_sha", &facts.head_sha) && covers("base_sha", &facts.base_sha);
    Ok(Plan { facts, session, prompt, argv, up_to_date })
}

/// Writes the tour, reporting each stage through `progress`.
pub async fn generate(request: &Request, progress: impl Fn(String)) -> Result<Outcome, Failure> {
    let plan = plan(request).await?;
    let facts = &plan.facts;
    if plan.up_to_date && !request.force {
        return Ok(Outcome::UpToDate { path: facts.tour_path.clone(), head: facts.head_sha.clone() });
    }
    let _lock = lock::Lock::take(facts.tour_path.lock(), "a tour for this branch is already being written")?;
    progress(format!("Writing the tour with {}…", sessions::describe(plan.session.as_ref())));
    let output = run_claude(&plan.argv, &plan.prompt, &facts.root, Reply::Tour).await?;
    let own_session = output["session_id"].as_str().and_then(|s| SessionId::try_from(s).ok()).ok_or("claude returned no session id")?;
    let mut tour = with_facts(output, facts, &own_session);
    let mut problems = validate::validate(&tour, &facts.root).await;
    if !problems.is_empty() {
        progress(format!("The tour has {} problems; asking for a fix…", problems.len()));
        let list: Vec<String> = problems.iter().map(|p| format!("- {p}")).collect();
        let fix = format!("The tour has these problems. Fix them and answer with the whole corrected tour:\n\n{}", list.join("\n"));
        let output = run_claude(&prompt::claude_argv(Agent::Continue(&own_session), Reply::Tour)?, &fix, &facts.root, Reply::Tour).await?;
        tour = with_facts(output, facts, &own_session);
        problems = validate::validate(&tour, &facts.root).await;
        if !problems.is_empty() {
            return Err(Failure(format!("the tour is still invalid after one fix; nothing was written:\n{}", problems.join("\n"))));
        }
    }
    crate::files::write_json(facts.tour_path.as_path(), &tour)?;
    let summary = validate::summary(&tour).trim_start_matches("ok: ").to_owned();
    Ok(Outcome::Written { path: facts.tour_path.clone(), summary })
}

async fn run_claude(argv: &[String], prompt: &str, root: &RepoRoot, reply: Reply) -> Result<Value, Failure> {
    let path = tokio::task::spawn_blocking(crate::tool_path::get).await.map_err(|e| Failure(e.to_string()))?;
    let mut child = Command::new(&argv[0])
        .args(&argv[1..])
        .env("PATH", path)
        .current_dir(root.as_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => Failure("cannot find `claude`: install Claude Code, or add its folder to your login shell's PATH".into()),
            _ => Failure(format!("cannot run claude: {e}")),
        })?;
    let mut stdin = child.stdin.take().expect("stdin is piped");
    let prompt = prompt.to_owned();
    let feeding = tokio::spawn(async move {
        let _ = stdin.write_all(prompt.as_bytes()).await;
    });
    let finished = tokio::time::timeout(TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| Failure(format!("claude did not finish within {} minutes", TIMEOUT.as_secs() / 60)))?
        .map_err(|e| Failure(format!("claude failed: {e}")))?;
    let _ = feeding.await;
    let stdout = String::from_utf8_lossy(&finished.stdout);
    let Ok(output) = serde_json::from_str::<Value>(&stdout) else {
        let stderr = String::from_utf8_lossy(&finished.stderr);
        let shown = if stderr.trim().is_empty() { stdout.trim() } else { stderr.trim() };
        let code = finished.status.code().map_or_else(|| "a signal".to_owned(), |c| c.to_string());
        return Err(Failure(format!("claude exited with {code}: {}", shown.chars().take(500).collect::<String>())));
    };
    let missing = match reply {
        Reply::Tour => output["structured_output"].is_null(),
        Reply::Text => !output["result"].as_str().is_some_and(|r| !r.trim().is_empty()),
    };
    if output["is_error"].as_bool() == Some(true) || missing {
        let result = match &output["result"] {
            Value::Null => "None".to_owned(),
            Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        let subtype = output["subtype"].as_str().unwrap_or("None");
        let wanted = if reply == Reply::Tour { "tour" } else { "answer" };
        return Err(Failure(format!("claude returned no {wanted} ({subtype}): {}", result.chars().take(500).collect::<String>())));
    }
    Ok(output)
}

fn with_facts(output: Value, facts: &Facts, session: &SessionId) -> Value {
    let mut tour = output["structured_output"].clone();
    if let Some(tour) = tour.as_object_mut() {
        tour.insert("version".into(), json!(1));
        tour.insert("branch".into(), json!(facts.branch));
        tour.insert("base".into(), json!(facts.base));
        tour.insert("base_sha".into(), json!(facts.base_sha));
        tour.insert("head_sha".into(), json!(facts.head_sha));
        tour.insert("author".into(), json!({"agent": "claude-code", "session": session}));
        tour.insert("created_at".into(), json!(chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()));
    }
    tour
}


/// `pr-tour generate [[base...]branch] [--base <branch>] [--repo <path>] [--fresh | --session <id>]
///                   [--force] [--output <file>] [--dry-run]`
pub fn cli(args: &[String]) -> i32 {
    let (request, dry_run) = match parse(args) {
        Ok(parsed) => parsed,
        Err(message) => {
            eprintln!("pr-tour generate: {message}");
            eprintln!("usage: pr-tour generate [[base...]branch] [--base <branch>] [--repo <path>] [--fresh | --session <id>] [--force] [--output <file>] [--dry-run]");
            return 2;
        }
    };
    let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("tokio runtime");
    let result = runtime.block_on(async {
        if dry_run {
            show_plan(&plan(&request).await?);
            return Ok(());
        }
        match generate(&request, |line| eprintln!("{line}")).await? {
            Outcome::UpToDate { path, head } => println!("{path} already covers {}; --force to rewrite", &head.as_str()[..7]),
            Outcome::Written { path, summary } => println!("{path}: {summary}"),
        }
        Ok::<(), Failure>(())
    });
    match result {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("pr-tour: {error}");
            1
        }
    }
}

fn show_plan(plan: &Plan) {
    let Plan { facts, session, prompt, argv, up_to_date } = plan;
    let schema_at = argv.iter().position(|a| a == "--json-schema").map(|i| i + 1);
    let shown: Vec<&str> = argv.iter().enumerate().map(|(i, a)| if Some(i) == schema_at { "<skill/tour.schema.json>" } else { a }).collect();
    let short = |sha: &str| sha[..7.min(sha.len())].to_owned();
    eprintln!("repo:     {}", facts.root);
    eprintln!("branch:   {} at {}", facts.branch, short(facts.head_sha.as_str()));
    eprintln!("base:     {} (merge base {})", facts.base, short(facts.base_sha.as_str()));
    let exists = if *up_to_date { " (exists for this commit; --force to rewrite)" } else { "" };
    eprintln!("tour:     {}{exists}", facts.tour_path);
    eprintln!("agent:    {}", sessions::describe(session.as_ref()));
    eprintln!("command:  {}", shown.join(" "));
    eprintln!("prompt:   {} characters on stdin, below", prompt.chars().count());
    eprintln!("{}", "-".repeat(72));
    println!("{prompt}");
}

fn parse(args: &[String]) -> Result<(Request, bool), String> {
    let mut request = Request { repo: PathBuf::from("."), branch: None, base: None, agent: AgentChoice::Newest, force: false, output: None };
    let mut dry_run = false;
    let mut branch = None;
    let mut args = args.iter();
    fn value(flag: &str, args: &mut std::slice::Iter<String>) -> Result<String, String> {
        args.next().cloned().ok_or(format!("{flag} needs a value"))
    }
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--base" => request.base = Some(BranchName::try_from(value("--base", &mut args)?)?),
            "--repo" => request.repo = PathBuf::from(value("--repo", &mut args)?),
            "--fresh" | "--session" if !matches!(request.agent, AgentChoice::Newest) => return Err("--fresh and --session exclude each other".into()),
            "--fresh" => request.agent = AgentChoice::Fresh,
            "--session" => request.agent = AgentChoice::Session(SessionId::try_from(value("--session", &mut args)?)?),
            "--force" => request.force = true,
            "--dry-run" => dry_run = true,
            "--output" => {
                let path = std::path::absolute(value("--output", &mut args)?).map_err(|e| e.to_string())?;
                request.output = Some(TourPath::try_from(path)?);
            }
            flag if flag.starts_with('-') => return Err(format!("unknown option {flag}")),
            _ if branch.is_none() => branch = Some(BranchArg::try_from(arg.as_str())?),
            _ => return Err(format!("unexpected argument {arg}")),
        }
    }
    if let Some(branch) = branch {
        (request.branch, request.base) = branch.with_base(request.base).map(|(b, base)| (Some(b), base))?;
    }
    Ok((request, dry_run))
}
