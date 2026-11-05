//! Sets up an app installed from a release: the `pr-tour` command on the PATH
//! and the Claude Code skill, both from this binary. A development setup,
//! where install.sh links both to a checkout, is left alone.

use serde::Serialize;
use std::path::{Path, PathBuf};

const SKILL_FILES: [(&str, &str); 3] = [
    ("SKILL.md", include_str!("../../../skill/SKILL.md")),
    ("PROMPT.md", include_str!("../../../skill/PROMPT.md")),
    ("tour.schema.json", include_str!("../../../skill/tour.schema.json")),
];
/// Marks a skill folder this binary wrote, so it may rewrite it.
const MARKER: &str = ".installed-by-pr-tour";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Part {
    Missing,
    Installed,
    /// Installed by another copy of the app, or an older skill from this one.
    Outdated,
    /// Set up by hand or by install.sh; never replaced.
    Elsewhere,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Setup {
    pub command: Part,
    pub skill: Part,
    pub command_path: PathBuf,
    pub skill_path: PathBuf,
}

impl Setup {
    pub fn complete(&self) -> bool {
        self.command == Part::Installed && self.skill == Part::Installed
    }
}

fn home() -> Result<PathBuf, String> {
    std::env::var_os("HOME").map(PathBuf::from).ok_or_else(|| "HOME is not set".into())
}

/// The binary to link: inside the .app, not a temporary copy the system made.
fn own_binary() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("cannot find this binary: {e}"))?;
    exe.canonicalize().map_err(|e| format!("cannot resolve {}: {e}", exe.display()))
}

/// Started from the disk image or a quarantined download, the app runs from a
/// read-only, randomized location; a link to it would break.
fn runs_from_a_temporary_place(binary: &Path) -> bool {
    let shown = binary.to_string_lossy();
    shown.starts_with("/Volumes/") || shown.contains("/AppTranslocation/")
}

fn command_part(link: &Path, binary: &Path) -> Part {
    match std::fs::read_link(link) {
        Ok(target) if target == binary => Part::Installed,
        Ok(target) if target.components().any(|c| c.as_os_str().to_string_lossy().ends_with(".app")) => Part::Outdated,
        Ok(_) | Err(_) if link.symlink_metadata().is_ok() => Part::Elsewhere,
        _ => Part::Missing,
    }
}

fn skill_part(folder: &Path) -> Part {
    let Ok(meta) = folder.symlink_metadata() else { return Part::Missing };
    if meta.file_type().is_symlink() || !folder.join(MARKER).exists() {
        return Part::Elsewhere;
    }
    let current = SKILL_FILES.iter().all(|(name, text)| std::fs::read_to_string(folder.join(name)).is_ok_and(|t| t == *text));
    if current { Part::Installed } else { Part::Outdated }
}

pub fn status() -> Result<Setup, String> {
    let home = home()?;
    let (command_path, skill_path) = (home.join(".local/bin/pr-tour"), home.join(".claude/skills/pr-tour"));
    Ok(Setup { command: command_part(&command_path, &own_binary()?), skill: skill_part(&skill_path), command_path, skill_path })
}

/// Installs what's missing or outdated; never touches a setup made elsewhere.
pub fn install() -> Result<Setup, String> {
    let setup = status()?;
    if matches!(setup.command, Part::Missing | Part::Outdated) {
        let binary = own_binary()?;
        if runs_from_a_temporary_place(&binary) {
            return Err("Move PR Tour to Applications first, then open it from there".into());
        }
        let folder = setup.command_path.parent().expect("the command lives in a folder");
        std::fs::create_dir_all(folder).map_err(|e| format!("cannot create {}: {e}", folder.display()))?;
        let _ = std::fs::remove_file(&setup.command_path);
        std::os::unix::fs::symlink(&binary, &setup.command_path).map_err(|e| format!("cannot link {}: {e}", setup.command_path.display()))?;
    }
    if matches!(setup.skill, Part::Missing | Part::Outdated) {
        write_skill(&setup.skill_path)?;
    }
    status()
}

fn write_skill(folder: &Path) -> Result<(), String> {
    std::fs::create_dir_all(folder).map_err(|e| format!("cannot create {}: {e}", folder.display()))?;
    for (name, text) in SKILL_FILES.iter().copied().chain([(MARKER, "")]) {
        let path = folder.join(name);
        std::fs::write(&path, text).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    }
    Ok(())
}

/// Brings a skill this app installed up to date with this binary, as after
/// installing a newer release.
pub fn refresh_skill() {
    if let Ok(setup) = status() {
        if setup.skill == Part::Outdated {
            let _ = write_skill(&setup.skill_path);
        }
    }
}

/// Whether the folder is on the login shell's PATH, where Claude Code's
/// Bash tool and terminals look for commands.
fn on_path(folder: &Path) -> bool {
    crate::tool_path::get().split(':').any(|entry| Path::new(entry) == folder)
}

/// `pr-tour install`
pub fn cli(args: &[String]) -> i32 {
    if let Some(arg) = args.first() {
        eprintln!("pr-tour install: unexpected argument {arg}\nusage: pr-tour install");
        return 2;
    }
    match install() {
        Ok(setup) => {
            report("command", setup.command, &setup.command_path);
            report("skill", setup.skill, &setup.skill_path);
            let folder = setup.command_path.parent().expect("the command lives in a folder");
            if setup.command == Part::Installed && !on_path(folder) {
                println!("note: {} is not on your PATH; add it to use `pr-tour` in a terminal", folder.display());
            }
            0
        }
        Err(error) => {
            eprintln!("pr-tour install: {error}");
            1
        }
    }
}

fn report(what: &str, part: Part, path: &Path) {
    let state = match part {
        Part::Installed => "installed",
        Part::Elsewhere => "left as it is (set up elsewhere)",
        Part::Missing | Part::Outdated => "not installed",
    };
    println!("{what}: {} {state}", path.display());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("pr-tour-install-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        folder
    }

    #[test]
    fn a_skill_is_only_replaced_when_this_app_wrote_it() {
        let root = scratch("skill");
        let skill = root.join("pr-tour");
        assert_eq!(skill_part(&skill), Part::Missing);
        write_skill(&skill).unwrap();
        assert_eq!(skill_part(&skill), Part::Installed);
        std::fs::write(skill.join("PROMPT.md"), "older").unwrap();
        assert_eq!(skill_part(&skill), Part::Outdated);
        std::fs::remove_file(skill.join(MARKER)).unwrap();
        assert_eq!(skill_part(&skill), Part::Elsewhere);
        let linked = root.join("linked");
        std::os::unix::fs::symlink(&skill, &linked).unwrap();
        assert_eq!(skill_part(&linked), Part::Elsewhere);
    }

    #[test]
    fn the_command_links_to_this_app() {
        let root = scratch("command");
        let link = root.join("pr-tour");
        let binary = PathBuf::from("/Applications/PR Tour.app/Contents/MacOS/pr-tour");
        assert_eq!(command_part(&link, &binary), Part::Missing);
        std::os::unix::fs::symlink(&binary, &link).unwrap();
        assert_eq!(command_part(&link, &binary), Part::Installed);
        assert_eq!(command_part(&link, Path::new("/Users/x/Applications/PR Tour.app/Contents/MacOS/pr-tour")), Part::Outdated);
        std::fs::remove_file(&link).unwrap();
        std::os::unix::fs::symlink("/src/pr-tour/app/src-tauri/target/release/pr-tour", &link).unwrap();
        assert_eq!(command_part(&link, &binary), Part::Elsewhere);
    }

    #[test]
    fn disk_images_and_translocated_apps_are_temporary() {
        assert!(runs_from_a_temporary_place(Path::new("/Volumes/PR Tour/PR Tour.app/Contents/MacOS/pr-tour")));
        assert!(runs_from_a_temporary_place(Path::new("/private/var/folders/x/AppTranslocation/y/d/PR Tour.app/Contents/MacOS/pr-tour")));
        assert!(!runs_from_a_temporary_place(Path::new("/Applications/PR Tour.app/Contents/MacOS/pr-tour")));
    }
}
