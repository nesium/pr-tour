//! The PATH to run `claude` with. Started from Finder or the Dock, an app gets
//! only the system's PATH, without the folders Claude Code and Homebrew install
//! into; the user's login shell has them.

use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::Duration;

const SHELL_TIMEOUT: Duration = Duration::from_secs(5);

/// This process's PATH, extended by the login shell's when `claude` isn't on
/// it. Asks the shell at most once; blocks while it does.
pub fn get() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        let own = std::env::var("PATH").unwrap_or_default();
        if finds(&own, "claude") {
            return own;
        }
        let shell = login_shell_path().unwrap_or_default();
        then_missing(&then_missing(&shell, &own), &usual_folders().join(":"))
    })
}

/// Where Claude Code's installers put `claude`, in case the shell knows none.
fn usual_folders() -> Vec<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    vec![format!("{home}/.local/bin"), format!("{home}/.claude/local"), "/opt/homebrew/bin".into(), "/usr/local/bin".into()]
}

/// The account's login shell. Apps started from Finder may have no $SHELL.
fn login_shell() -> String {
    // SAFETY: getpwuid returns null or a pointer to a static record, read at once.
    let from_account = unsafe {
        let entry = libc::getpwuid(libc::getuid());
        (!entry.is_null() && !(*entry).pw_shell.is_null())
            .then(|| std::ffi::CStr::from_ptr((*entry).pw_shell).to_string_lossy().into_owned())
    };
    from_account.filter(|s| !s.is_empty()).or_else(|| std::env::var("SHELL").ok()).unwrap_or_else(|| "/bin/zsh".into())
}

fn finds(path: &str, program: &str) -> bool {
    path.split(':').any(|folder| Path::new(folder).join(program).is_file())
}

/// The entries of `first`, then those of `then` it lacks.
fn then_missing(first: &str, then: &str) -> String {
    let mut entries: Vec<&str> = first.split(':').filter(|e| !e.is_empty()).collect();
    for entry in then.split(':').filter(|e| !e.is_empty()) {
        if !entries.contains(&entry) {
            entries.push(entry);
        }
    }
    entries.join(":")
}

/// `env` rather than `echo $PATH`: fish keeps PATH as a list, but exports it
/// joined. Interactive, so zsh reads .zshrc too; its output may be noisy, so
/// only the PATH line counts.
fn login_shell_path() -> Option<String> {
    let mut child = Command::new(login_shell())
        .args(["-l", "-i", "-c", "/usr/bin/env"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let started = std::time::Instant::now();
    while child.try_wait().ok()?.is_none() {
        if started.elapsed() > SHELL_TIMEOUT {
            let _ = child.kill();
            return None;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let output = child.wait_with_output().ok()?;
    parse_path(&String::from_utf8_lossy(&output.stdout))
}

fn parse_path(env: &str) -> Option<String> {
    env.lines().filter_map(|line| line.strip_prefix("PATH=")).next_back().map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entries_are_added_once_in_order() {
        assert_eq!(then_missing("/Users/x/.local/bin:/usr/bin", "/usr/bin:/bin"), "/Users/x/.local/bin:/usr/bin:/bin");
        assert_eq!(then_missing("", "/usr/bin"), "/usr/bin");
    }

    #[test]
    fn only_the_path_line_counts() {
        assert_eq!(parse_path("Welcome!\nHOME=/x\nPATH=/a:/b\n").as_deref(), Some("/a:/b"));
        assert_eq!(parse_path("HOME=/x"), None);
    }
}
