//! Serializes app startups. The single-instance plugin finds a running app by
//! connecting to its socket; two apps starting together both fail to connect,
//! and both become "the" instance. Holding this lock from before the plugin
//! runs until the socket is bound makes a second start wait, then hand over.

use std::fs::File;

/// Held from process start until the app's single-instance socket is bound.
/// Released by dropping it, or by the process exiting (handing over to a running app).
pub struct LaunchLock(#[allow(dead_code)] Option<File>);

impl LaunchLock {
    /// Waits for any other starting app. If the lock can't be taken, starts
    /// anyway: a rare second instance beats not starting.
    pub fn acquire() -> Self {
        let path = std::env::temp_dir().join("com.nesium.pr-tour.launch.lock");
        let Ok(file) = File::options().create(true).truncate(false).write(true).open(path) else {
            return LaunchLock(None);
        };
        LaunchLock(lock_exclusive(&file).then_some(file))
    }
}

#[cfg(unix)]
fn lock_exclusive(file: &File) -> bool {
    use std::os::fd::AsRawFd;
    // SAFETY: flock on a descriptor we own; the lock goes with the descriptor.
    unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) == 0 }
}

#[cfg(not(unix))]
fn lock_exclusive(_file: &File) -> bool {
    true
}
