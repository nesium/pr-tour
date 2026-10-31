use super::Failure;
use crate::types::LockPath;
use std::fs::OpenOptions;
use std::io::Write;

/// One holder at a time, e.g. one generation per tour; removed when dropped.
/// A lock left by a dead process is taken over.
pub struct Lock(LockPath);

impl Lock {
    /// `busy` says what holds the lock, for the error when another process does.
    pub fn take(lock: LockPath, busy: &str) -> Result<Self, Failure> {
        if let Some(folder) = lock.as_path().parent() {
            std::fs::create_dir_all(folder).map_err(|e| Failure(format!("cannot create {}: {e}", folder.display())))?;
        }
        for _ in 0..2 {
            match OpenOptions::new().write(true).create_new(true).open(&lock) {
                Ok(mut file) => {
                    let _ = write!(file, "{}", std::process::id());
                    return Ok(Lock(lock));
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    let holder = std::fs::read_to_string(&lock).ok().and_then(|t| t.trim().parse::<i32>().ok());
                    match holder {
                        Some(pid) if is_alive(pid) => {
                            return Err(Failure(format!("{busy} (process {pid})")));
                        }
                        _ => {
                            let _ = std::fs::remove_file(&lock);
                        }
                    }
                }
                Err(e) => return Err(Failure(format!("cannot take the lock {lock}: {e}"))),
            }
        }
        Err(Failure(format!("cannot take the lock {lock}")))
    }
}

impl Drop for Lock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[cfg(unix)]
fn is_alive(pid: i32) -> bool {
    if pid <= 0 {
        return false;
    }
    // Signal 0 only checks the process: EPERM means it exists but isn't ours.
    // SAFETY: kill with signal 0 sends nothing and has no side effects.
    let result = unsafe { libc::kill(pid, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn is_alive(_pid: i32) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    use crate::types::TourPath;

    fn tour_in(folder: &tempfile::TempDir) -> TourPath {
        TourPath::try_from(folder.path().join("b.json")).unwrap()
    }

    fn take(tour: &TourPath) -> Result<Lock, Failure> {
        Lock::take(tour.lock(), "busy")
    }

    #[test]
    fn excludes_a_second_writer_and_releases_on_drop() {
        let folder = tempfile::tempdir().unwrap();
        let tour = tour_in(&folder);
        let held = take(&tour).unwrap();
        assert!(take(&tour).is_err());
        drop(held);
        assert!(!tour.lock().as_path().exists());
        assert!(take(&tour).is_ok());
    }

    #[test]
    fn takes_over_a_dead_writers_lock() {
        let folder = tempfile::tempdir().unwrap();
        let tour = tour_in(&folder);
        std::fs::write(PathBuf::from(tour.lock().as_path()), "999999999").unwrap();
        assert!(take(&tour).is_ok());
    }
}
