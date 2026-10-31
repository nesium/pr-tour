//! The domain's values, each its own type. The ones with rules check them on
//! construction, including when they arrive from the webview, so a value that
//! exists is valid.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::num::NonZeroU64;
use std::path::{Path, PathBuf};

macro_rules! string_newtype {
    ($(#[$doc:meta])* $name:ident, $check:expr) => {
        $(#[$doc])*
        #[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
        #[serde(try_from = "String", into = "String")]
        pub struct $name(String);

        impl $name {
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl TryFrom<String> for $name {
            type Error = String;
            fn try_from(value: String) -> Result<Self, String> {
                let check: fn(&str) -> Result<(), String> = $check;
                check(&value).map(|()| Self(value))
            }
        }

        impl TryFrom<&str> for $name {
            type Error = String;
            fn try_from(value: &str) -> Result<Self, String> {
                Self::try_from(value.to_owned())
            }
        }

        impl From<$name> for String {
            fn from(value: $name) -> String {
                value.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

macro_rules! path_newtype {
    ($(#[$doc:meta])* $name:ident, $check:expr) => {
        $(#[$doc])*
        #[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(try_from = "PathBuf", into = "PathBuf")]
        pub struct $name(PathBuf);

        impl $name {
            pub fn as_path(&self) -> &Path {
                &self.0
            }
        }

        impl TryFrom<PathBuf> for $name {
            type Error = String;
            fn try_from(value: PathBuf) -> Result<Self, String> {
                let check: fn(&Path) -> Result<(), String> = $check;
                check(&value).map(|()| Self(value))
            }
        }

        impl From<$name> for PathBuf {
            fn from(value: $name) -> PathBuf {
                value.0
            }
        }

        impl AsRef<Path> for $name {
            fn as_ref(&self) -> &Path {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.display().fmt(f)
            }
        }
    };
}

string_newtype!(
    /// A full or abbreviated commit id. Hex only, so git can never read one as an option.
    CommitId,
    |v| {
        let hex = (4..=64).contains(&v.len()) && v.bytes().all(|b| b.is_ascii_hexdigit());
        if hex { Ok(()) } else { Err(format!("not a commit id: {v}")) }
    }
);

string_newtype!(
    /// A branch name as git knows it, e.g. `feat/x`.
    BranchName,
    |v| {
        if v.is_empty() || v.starts_with('-') || v.contains(char::is_whitespace) {
            Err(format!("not a branch name: {v:?}"))
        } else {
            Ok(())
        }
    }
);

string_newtype!(
    /// A file in the repository, relative to its root, as diffs name it.
    RepoFile,
    |v| if v.is_empty() || v.starts_with('/') { Err(format!("not a repository path: {v:?}")) } else { Ok(()) }
);

string_newtype!(
    /// A tour step's id: `[a-z0-9-]+`.
    StepId,
    |v| {
        let valid = !v.is_empty() && v.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
        if valid { Ok(()) } else { Err("id must match [a-z0-9-]+".into()) }
    }
);

string_newtype!(
    /// A Claude Code session, as named by its transcript file and `--resume`.
    SessionId,
    |v| {
        let valid = !v.is_empty() && !v.starts_with('-') && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        if valid { Ok(()) } else { Err(format!("not a session id: {v:?}")) }
    }
);

path_newtype!(
    /// The top of a work tree.
    RepoRoot,
    |p| if p.is_absolute() { Ok(()) } else { Err(format!("not an absolute path: {}", p.display())) }
);

path_newtype!(
    /// The folder that holds a repository's tours: `<git common dir>/pr-tours`,
    /// shared by all of its worktrees.
    ToursFolder,
    |p| if p.is_absolute() { Ok(()) } else { Err(format!("not an absolute path: {}", p.display())) }
);

path_newtype!(
    /// A tour file. The webview can only name these, never arbitrary paths.
    TourPath,
    |p| {
        if p.is_absolute() && p.extension().is_some_and(|e| e == "json") {
            Ok(())
        } else {
            Err(format!("not a tour file: {}", p.display()))
        }
    }
);

path_newtype!(
    /// Exists while a tour is being written.
    LockPath,
    |_| Ok(())
);

impl BranchName {
    pub fn tour_file_name(&self) -> String {
        format!("{}.json", self.0.replace('/', "__"))
    }
}

impl ToursFolder {
    pub fn tour_for(&self, branch: &BranchName) -> TourPath {
        TourPath(self.0.join(branch.tour_file_name()))
    }
}

impl TourPath {
    pub fn lock(&self) -> LockPath {
        LockPath(self.0.with_extension("lock"))
    }
}

/// Which version of a file an anchor's line numbers refer to.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    /// The file at base_sha, for removed code.
    Old,
    /// The file at head_sha.
    #[default]
    New,
}

impl Side {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "old" => Some(Side::Old),
            "new" => Some(Side::New),
            _ => None,
        }
    }
}

impl fmt::Display for Side {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Side::Old => "old",
            Side::New => "new",
        })
    }
}

/// A 1-based line number.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct LineNumber(NonZeroU64);

impl LineNumber {
    pub fn new(value: u64) -> Option<Self> {
        NonZeroU64::new(value).map(Self)
    }

    pub fn get(self) -> u64 {
        self.0.get()
    }
}

impl fmt::Display for LineNumber {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// Lines start..=end, with start <= end.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LineRange {
    start: LineNumber,
    end: LineNumber,
}

impl LineRange {
    pub fn new(start: LineNumber, end: LineNumber) -> Option<Self> {
        (start <= end).then_some(Self { start, end })
    }

    pub fn start(self) -> LineNumber {
        self.start
    }

    pub fn end(self) -> LineNumber {
        self.end
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commit_ids_are_hex() {
        assert!(CommitId::try_from("2b54145").is_ok());
        assert!(CommitId::try_from("--output=/tmp/x").is_err());
        assert!(CommitId::try_from("abc").is_err());
    }

    #[test]
    fn branch_names_cannot_be_options() {
        assert!(BranchName::try_from("feat/x").is_ok());
        assert!(BranchName::try_from("-x").is_err());
        assert!(BranchName::try_from("").is_err());
    }

    #[test]
    fn tour_paths_are_absolute_json_files() {
        assert!(TourPath::try_from(PathBuf::from("/r/.git/pr-tours/a.json")).is_ok());
        assert!(TourPath::try_from(PathBuf::from("a.json")).is_err());
        assert!(TourPath::try_from(PathBuf::from("/etc/passwd")).is_err());
    }

    #[test]
    fn branch_slashes_become_double_underscores() {
        let folder = ToursFolder::try_from(PathBuf::from("/x")).unwrap();
        let tour = folder.tour_for(&BranchName::try_from("fix/a/b").unwrap());
        assert_eq!(tour.as_path(), Path::new("/x/fix__a__b.json"));
        assert_eq!(tour.lock().as_path(), Path::new("/x/fix__a__b.lock"));
    }

    #[test]
    fn step_ids_and_ranges() {
        assert!(StepId::try_from("parse-diff-2").is_ok());
        assert!(StepId::try_from("Parse").is_err());
        let line = |n| LineNumber::new(n).unwrap();
        assert!(LineRange::new(line(3), line(2)).is_none());
        assert!(LineNumber::new(0).is_none());
    }
}
