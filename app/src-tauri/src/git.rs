use std::path::Path;
use tokio::process::Command;

// Read-only: never take the index lock, never wake an fsmonitor, never refresh the index.
const READ: [&str; 6] = [
    "--no-optional-locks",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "diff.autoRefreshIndex=false",
    "--no-pager",
];

pub struct Output {
    pub success: bool,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

impl Output {
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }

    pub fn into_result(self, args: &[&str]) -> Result<String, String> {
        if self.success {
            return Ok(self.text());
        }
        let message = self.stderr.trim();
        Err(if message.is_empty() {
            format!("git {} failed", args.join(" "))
        } else {
            message.to_owned()
        })
    }
}

pub async fn run(cwd: &Path, args: &[&str]) -> Result<Output, String> {
    let output = Command::new("git")
        .args(READ)
        .args(args)
        .current_dir(cwd)
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| format!("cannot run git: {e}"))?;
    Ok(Output {
        success: output.status.success(),
        stdout: output.stdout,
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

pub async fn text(cwd: &Path, args: &[&str]) -> Result<String, String> {
    run(cwd, args).await?.into_result(args)
}
