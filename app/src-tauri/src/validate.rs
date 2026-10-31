//! Checks a tour against the tour format and the repository's real diff.
//! Ported from the former Python validator, whose messages it keeps word for
//! word: the skill and agents act on them.

use crate::types::{CommitId, LineNumber, LineRange, RepoFile, RepoRoot, Side, StepId};
use crate::{git, hunks::Covered};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use tokio::task::JoinSet;

const TOP_LEVEL: &[&str] = &[
    "version", "branch", "base", "base_sha", "head_sha", "author", "created_at", "intent",
    "reading_order", "steps", "concerns",
];
const REQUIRED: &[&str] = &[
    "version", "branch", "base", "base_sha", "head_sha", "intent", "reading_order", "steps",
    "concerns",
];
const STEP_KEYS: &[&str] = &["id", "tag", "hotspot", "title", "why", "check", "anchors"];
const ANCHOR_KEYS: &[&str] = &["file", "side", "start", "end"];
const MAX_TITLE_CHARS: usize = 60;
const MAX_HOTSPOTS: usize = 3;

struct Anchor {
    label: String,
    file: RepoFile,
    side: Side,
    lines: LineRange,
}

pub async fn validate(tour: &Value, repo: &RepoRoot) -> Vec<String> {
    let mut problems = Vec::new();
    let Some(tour) = tour.as_object() else {
        return vec!["tour must be a JSON object".into()];
    };
    if let Some(unknown) = unknown_keys(tour, TOP_LEVEL) {
        problems.push(format!("unknown top-level fields {unknown}"));
    }
    let missing: Vec<&str> = REQUIRED.iter().copied().filter(|k| !tour.contains_key(*k)).collect();
    if !missing.is_empty() {
        problems.push(format!("missing top-level fields {}", py_list(sorted(missing))));
        return problems;
    }
    if tour["version"].as_f64() != Some(1.0) {
        problems.push("version must be 1".into());
    }
    for key in ["intent", "branch", "base"] {
        if !tour[key].as_str().is_some_and(|s| !s.trim().is_empty()) {
            problems.push(format!("{key} must be a non-empty string"));
        }
    }

    let (base, head) = match resolve_commits(repo, &tour["base_sha"], &tour["head_sha"]).await {
        Ok(commits) => commits,
        Err(error) => {
            problems.push(format!("base_sha/head_sha: {error}"));
            return problems;
        }
    };

    match tour["reading_order"].as_array() {
        Some(entries) => {
            for (i, entry) in entries.iter().enumerate() {
                let complete = entry.as_object().is_some_and(|e| e.contains_key("file") && e.contains_key("why"));
                if !complete {
                    problems.push(format!("reading_order[{i}]: needs file and why"));
                }
            }
        }
        None => problems.push("reading_order must be an array".into()),
    }

    let mut anchors = Vec::new();
    match tour["steps"].as_array() {
        Some(steps) => check_steps(steps, &mut anchors, &mut problems),
        None => problems.push("steps must be an array".into()),
    }

    match tour["concerns"].as_array() {
        Some(concerns) => {
            for (i, concern) in concerns.iter().enumerate() {
                let Some(concern) = concern.as_object().filter(|c| c.get("text").is_some_and(Value::is_string)) else {
                    problems.push(format!("concerns[{i}]: needs text"));
                    continue;
                };
                if let Some(anchor) = concern.get("anchor") {
                    let label = format!("concerns[{i}].anchor");
                    if let Some(anchor) = check_anchor(anchor, &label, &mut problems) {
                        anchors.push(Anchor { label, ..anchor });
                    }
                }
            }
        }
        None => problems.push("concerns must be an array".into()),
    }

    let covered = covered_lines(repo, &base, &head, &anchors).await;
    for anchor in &anchors {
        match &covered[&anchor.file] {
            Ok(covered) if covered.overlaps(anchor.side, anchor.lines) => {}
            Ok(_) => problems.push(format!(
                "{}: {} {} L{}-{} overlaps no hunk of the diff",
                anchor.label, anchor.file, anchor.side, anchor.lines.start(), anchor.lines.end()
            )),
            Err(error) => problems.push(format!("{}: {}: {error}", anchor.label, anchor.file)),
        }
    }
    problems
}

fn check_steps(steps: &[Value], anchors: &mut Vec<Anchor>, problems: &mut Vec<String>) {
    let mut ids = HashSet::new();
    let mut hotspots = 0;
    for (i, step) in steps.iter().enumerate() {
        let place = format!("steps[{i}]");
        let Some(step) = step.as_object() else {
            problems.push(format!("{place}: must be an object"));
            continue;
        };
        if let Some(unknown) = unknown_keys(step, STEP_KEYS) {
            problems.push(format!("{place}: unknown fields {unknown}"));
        }
        for key in ["id", "tag", "title", "why", "anchors"] {
            if !step.contains_key(key) {
                problems.push(format!("{place}: missing {key}"));
            }
        }
        let label_id = step.get("id").map_or_else(String::new, display);
        match step.get("id").and_then(Value::as_str).map(StepId::try_from) {
            Some(Ok(id)) if ids.contains(&id) => problems.push(format!("{place}: duplicate id {id}")),
            Some(Ok(id)) => {
                ids.insert(id);
            }
            Some(Err(error)) => problems.push(format!("{place}: {error}")),
            None => problems.push(format!("{place}: id must match [a-z0-9-]+")),
        }
        if !matches!(step.get("tag").and_then(Value::as_str), Some("read_closely" | "skim")) {
            problems.push(format!("{place}: tag must be read_closely or skim"));
        }
        if step.get("hotspot").is_some_and(truthy) {
            hotspots += 1;
            if !step.get("check").is_some_and(truthy) {
                problems.push(format!("{place}: a hotspot needs a check"));
            }
        }
        if step.get("title").map_or(0, length) > MAX_TITLE_CHARS {
            problems.push(format!("{place}: title is longer than {MAX_TITLE_CHARS} characters"));
        }
        let step_anchors = match step.get("anchors") {
            Some(Value::Array(list)) => list.as_slice(),
            Some(value) if truthy(value) => {
                problems.push(format!("{place}: anchors must be an array"));
                continue;
            }
            _ => &[],
        };
        if step_anchors.is_empty() {
            problems.push(format!("{place}: needs at least one anchor"));
        }
        for (j, anchor) in step_anchors.iter().enumerate() {
            let label = format!("{place}.anchors[{j}]");
            if let Some(anchor) = check_anchor(anchor, &label, problems) {
                anchors.push(Anchor { label: format!("{label} ({label_id})"), ..anchor });
            }
        }
    }
    if hotspots > MAX_HOTSPOTS {
        problems.push(format!("{hotspots} hotspots; the tour asks for 2-3"));
    }
}

fn check_anchor(anchor: &Value, place: &str, problems: &mut Vec<String>) -> Option<Anchor> {
    let Some(anchor) = anchor.as_object() else {
        problems.push(format!("{place}: must be an object"));
        return None;
    };
    if let Some(unknown) = unknown_keys(anchor, ANCHOR_KEYS) {
        problems.push(format!("{place}: unknown fields {unknown}"));
    }
    for key in ["file", "start", "end"] {
        if !anchor.contains_key(key) {
            problems.push(format!("{place}: missing {key}"));
            return None;
        }
    }
    let side = match anchor.get("side").map(|s| s.as_str().and_then(Side::parse)) {
        None => Side::default(),
        Some(Some(side)) => side,
        Some(None) => {
            problems.push(format!("{place}: side must be new or old"));
            return None;
        }
    };
    let line = |key: &str| anchor[key].as_u64().and_then(LineNumber::new);
    let Some(lines) = line("start").zip(line("end")).and_then(|(start, end)| LineRange::new(start, end)) else {
        problems.push(format!("{place}: start and end must be integers with 1 <= start <= end"));
        return None;
    };
    let file = match anchor["file"].as_str().map(RepoFile::try_from) {
        Some(Ok(file)) => file,
        Some(Err(error)) => {
            problems.push(format!("{place}: {error}"));
            return None;
        }
        None => {
            problems.push(format!("{place}: file must be a string"));
            return None;
        }
    };
    Some(Anchor { label: String::new(), file, side, lines })
}

async fn resolve_commits(repo: &RepoRoot, base: &Value, head: &Value) -> Result<(CommitId, CommitId), String> {
    let commit = |sha: &Value| format!("{}^{{commit}}", display(sha));
    let (base, head) = (commit(base), commit(head));
    let (base_args, head_args) = (["rev-parse", "--verify", &base], ["rev-parse", "--verify", &head]);
    let (base, head) = tokio::join!(git::text(repo.as_path(), &base_args), git::text(repo.as_path(), &head_args));
    Ok((CommitId::try_from(base?.trim())?, CommitId::try_from(head?.trim())?))
}

/// The hunks of every anchored file, read in parallel.
async fn covered_lines(repo: &RepoRoot, base: &CommitId, head: &CommitId, anchors: &[Anchor]) -> HashMap<RepoFile, Result<Covered, String>> {
    let files: HashSet<&RepoFile> = anchors.iter().map(|a| &a.file).collect();
    let mut reads = JoinSet::new();
    for file in files {
        let (repo, base, head, file) = (repo.clone(), base.clone(), head.clone(), file.clone());
        reads.spawn(async move {
            let args = ["diff", "--no-ext-diff", "--no-color", base.as_str(), head.as_str(), "--", file.as_str()];
            let covered = git::text(repo.as_path(), &args).await.map(|diff| Covered::parse(&diff));
            (file, covered)
        });
    }
    let mut covered = HashMap::new();
    while let Some(read) = reads.join_next().await {
        let (file, lines) = read.expect("a diff read panicked");
        covered.insert(file, lines);
    }
    covered
}

/// Python's truthiness, which the original checks rely on.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64() != Some(0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

fn length(value: &Value) -> usize {
    match value {
        Value::String(s) => s.chars().count(),
        Value::Array(a) => a.len(),
        Value::Object(o) => o.len(),
        _ => 0,
    }
}

fn display(value: &Value) -> String {
    value.as_str().map_or_else(|| value.to_string(), str::to_owned)
}

fn unknown_keys(object: &Map<String, Value>, allowed: &[&str]) -> Option<String> {
    let unknown: Vec<&str> = object.keys().map(String::as_str).filter(|k| !allowed.contains(k)).collect();
    (!unknown.is_empty()).then(|| py_list(sorted(unknown)))
}

fn sorted(mut items: Vec<&str>) -> Vec<&str> {
    items.sort_unstable();
    items
}

/// Formats like Python's repr of a list of strings, as the messages always have.
fn py_list(items: Vec<&str>) -> String {
    let quoted: Vec<String> = items.iter().map(|s| format!("'{s}'")).collect();
    format!("[{}]", quoted.join(", "))
}

pub fn summary(tour: &Value) -> String {
    let steps = tour["steps"].as_array().map_or(&[][..], Vec::as_slice);
    let closely = steps.iter().filter(|s| s["tag"] == "read_closely").count();
    let concerns = tour["concerns"].as_array().map_or(0, Vec::len);
    format!("ok: {} steps ({closely} read closely), {concerns} concerns", steps.len())
}

pub async fn validate_file(tour: &Path, repo: &RepoRoot) -> Result<(Value, Vec<String>), String> {
    let text = tokio::fs::read_to_string(tour).await.map_err(|e| format!("cannot read tour: {e}"))?;
    let tour: Value = serde_json::from_str(&text).map_err(|e| format!("cannot read tour: {e}"))?;
    let problems = validate(&tour, repo).await;
    Ok((tour, problems))
}

/// `pr-tour validate <tour.json> [--repo <path>]`: exits 0 when valid,
/// 1 with one problem per line otherwise.
pub fn cli(args: &[String]) -> i32 {
    let mut tour = None;
    let mut repo = ".".to_owned();
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--repo" => match args.next() {
                Some(path) => repo = path.clone(),
                None => return usage(),
            },
            "-h" | "--help" => return usage(),
            _ if tour.is_none() => tour = Some(arg.clone()),
            _ => return usage(),
        }
    }
    let Some(tour) = tour else { return usage() };
    let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("tokio runtime");
    let repo = match std::path::absolute(&repo).map_err(|e| e.to_string()).and_then(RepoRoot::try_from) {
        Ok(repo) => repo,
        Err(error) => {
            println!("--repo: {error}");
            return 1;
        }
    };
    match runtime.block_on(validate_file(Path::new(&tour), &repo)) {
        Err(error) => {
            println!("{error}");
            1
        }
        Ok((tour, problems)) if problems.is_empty() => {
            println!("{}", summary(&tour));
            0
        }
        Ok((_, problems)) => {
            problems.iter().for_each(|p| println!("{p}"));
            1
        }
    }
}

fn usage() -> i32 {
    eprintln!("usage: pr-tour validate <tour.json> [--repo <path>]");
    2
}
