//! The JSON files kept next to a tour (answers, review): written in one step,
//! and changed only under a short write lock, so the app and the command line
//! can both change them.

use crate::generate::lock::Lock;
use crate::generate::Failure;
use crate::types::LockPath;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;
use std::io::Write;
use std::path::Path;
use std::time::Duration;

/// Replaces the file in one step, so readers never see half of it.
pub fn write_json(path: &Path, value: &impl Serialize) -> Result<(), Failure> {
    let folder = path.parent().ok_or("file has no folder")?;
    let fail = |e: std::io::Error| Failure(format!("cannot write {}: {e}", path.display()));
    std::fs::create_dir_all(folder).map_err(fail)?;
    let mut temporary = tempfile::Builder::new().prefix(".tour-").suffix(".json").tempfile_in(folder).map_err(fail)?;
    let text = serde_json::to_string_pretty(value).map_err(|e| Failure(e.to_string()))?;
    writeln!(temporary, "{text}").map_err(fail)?;
    temporary.persist(path).map_err(|e| fail(e.error))?;
    Ok(())
}

/// The file's contents, or `T::default()` when it's missing or unreadable.
pub async fn read_json<T: DeserializeOwned + Default>(path: &Path) -> T {
    let text = tokio::fs::read_to_string(path).await.ok();
    text.and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// Applies `change` to the file under `write_lock`, waiting up to five
/// seconds for another writer, and returns what `change` returned.
pub async fn update_json<T, R>(path: &Path, write_lock: LockPath, change: impl FnOnce(&mut T) -> R) -> Result<R, Failure>
where
    T: Serialize + DeserializeOwned + Default,
{
    let mut change = Some(change);
    for _ in 0..50 {
        match Lock::take(write_lock.clone(), "the file is being written") {
            Ok(_writing) => {
                let mut value = read_json(path).await;
                let result = (change.take().expect("applied once"))(&mut value);
                write_json(path, &value)?;
                return Ok(result);
            }
            Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
        }
    }
    Err(Failure(format!("cannot write {}", path.display())))
}

pub fn now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// Twelve random hex characters, for ids within one file.
pub fn random_id() -> String {
    let random = RandomState::new().hash_one(std::time::SystemTime::now());
    format!("{:012x}", random & 0xffff_ffff_ffff)
}
