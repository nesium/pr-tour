//! File globs for a tour's `skipped` entries: `*` matches within one folder,
//! `**` across folders (`**/` also matches no folder at all), `?` one
//! character. The viewer's lib/glob.ts matches the same way.

use crate::types::RepoFile;
use std::fmt;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileGlob(String);

impl TryFrom<&str> for FileGlob {
    type Error = String;
    fn try_from(value: &str) -> Result<Self, String> {
        if value.trim().is_empty() {
            Err("file must not be empty".into())
        } else {
            Ok(FileGlob(value.to_owned()))
        }
    }
}

impl fmt::Display for FileGlob {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl FileGlob {
    pub fn matches(&self, file: &RepoFile) -> bool {
        let pattern: Vec<char> = self.0.chars().collect();
        let path: Vec<char> = file.as_str().chars().collect();
        matches(&pattern, &path)
    }
}

fn matches(pattern: &[char], path: &[char]) -> bool {
    match pattern {
        [] => path.is_empty(),
        ['*', '*', '/', rest @ ..] => {
            matches(rest, path) || path.iter().enumerate().any(|(i, c)| *c == '/' && matches(rest, &path[i + 1..]))
        }
        ['*', '*', rest @ ..] => (0..=path.len()).any(|i| matches(rest, &path[i..])),
        ['*', rest @ ..] => {
            let folder_end = path.iter().position(|c| *c == '/').unwrap_or(path.len());
            (0..=folder_end).any(|i| matches(rest, &path[i..]))
        }
        ['?', rest @ ..] => path.first().is_some_and(|c| *c != '/') && matches(rest, &path[1..]),
        [c, rest @ ..] => path.first() == Some(c) && matches(rest, &path[1..]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(glob: &str, file: &str) -> bool {
        FileGlob::try_from(glob).unwrap().matches(&RepoFile::try_from(file).unwrap())
    }

    #[test]
    fn plain_paths_match_only_themselves() {
        assert!(hit("app/Cargo.lock", "app/Cargo.lock"));
        assert!(!hit("app/Cargo.lock", "app/src/Cargo.lock"));
    }

    #[test]
    fn a_star_stays_in_its_folder() {
        assert!(hit("icons/*.png", "icons/32x32.png"));
        assert!(!hit("icons/*.png", "icons/ios/32x32.png"));
        assert!(hit("*.md", "README.md"));
        assert!(!hit("*.md", "docs/README.md"));
    }

    #[test]
    fn a_double_star_crosses_folders_and_may_match_none() {
        assert!(hit("**/*.lock", "Cargo.lock"));
        assert!(hit("**/*.lock", "app/src-tauri/Cargo.lock"));
        assert!(hit("app/src-tauri/icons/**", "app/src-tauri/icons/ios/AppIcon.png"));
        assert!(!hit("app/src-tauri/icons/**", "app/src-tauri/src/main.rs"));
    }

    #[test]
    fn a_question_mark_is_one_character_but_no_slash() {
        assert!(hit("v?.json", "v1.json"));
        assert!(!hit("a?b", "a/b"));
    }
}
