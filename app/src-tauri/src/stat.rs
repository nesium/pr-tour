use crate::types::RepoFile;
use serde::Serialize;

/// One changed file's size, as `git diff --numstat` counts it.
#[derive(Debug, PartialEq, Serialize)]
pub struct FileStat {
    pub file: RepoFile,
    /// None for a binary file, whose lines git doesn't count.
    pub added: Option<u64>,
    pub removed: Option<u64>,
}

/// Parses `git diff --numstat -z --no-renames`: `added\tremoved\tpath\0` per file.
pub fn parse_numstat(output: &str) -> Vec<FileStat> {
    output
        .split('\0')
        .filter_map(|entry| {
            let mut fields = entry.splitn(3, '\t');
            let (added, removed, path) = (fields.next()?, fields.next()?, fields.next()?);
            Some(FileStat { file: RepoFile::try_from(path).ok()?, added: added.parse().ok(), removed: removed.parse().ok() })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_text_and_binary_files() {
        let stats = parse_numstat("12\t3\tsrc/a b.rs\0-\t-\tassets/icon.png\0");
        assert_eq!(stats.len(), 2);
        assert_eq!(stats[0], FileStat { file: RepoFile::try_from("src/a b.rs").unwrap(), added: Some(12), removed: Some(3) });
        assert_eq!((stats[1].added, stats[1].removed), (None, None));
    }

    #[test]
    fn nothing_changed_is_no_files() {
        assert!(parse_numstat("").is_empty());
    }
}
