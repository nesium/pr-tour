use crate::git;
use crate::types::{BranchName, LockPath, RepoRoot, TourPath, ToursFolder};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Located {
    pub root: RepoRoot,
    pub branch: BranchName,
    pub folder: ToursFolder,
    pub path: TourPath,
    pub lock: LockPath,
}

/// Where the tour of a branch lives: `<git common dir>/pr-tours/<branch>.json`.
/// Without a branch, it's the one checked out in `repo`.
pub async fn locate(repo: &Path, branch: Option<BranchName>, tour: Option<TourPath>) -> Result<Located, String> {
    let root = git::text(repo, &["rev-parse", "--show-toplevel"])
        .await
        .map_err(|_| format!("Not a git repository: {}", repo.display()))?;
    let root = RepoRoot::try_from(PathBuf::from(root.trim()))?;
    let (common, current) = tokio::join!(
        git::text(root.as_path(), &["rev-parse", "--path-format=absolute", "--git-common-dir"]),
        git::run(root.as_path(), &["symbolic-ref", "--short", "-q", "HEAD"]),
    );
    let branch = match branch {
        Some(branch) => branch,
        None => current
            .ok()
            .and_then(|o| BranchName::try_from(o.text().trim()).ok())
            .ok_or("Detached HEAD: open the tour with a branch")?,
    };
    let folder = ToursFolder::try_from(PathBuf::from(common?.trim()).join("pr-tours"))?;
    tokio::fs::create_dir_all(&folder).await.map_err(|e| format!("cannot create {folder}: {e}"))?;
    let path = tour.unwrap_or_else(|| folder.tour_for(&branch));
    Ok(Located { lock: path.lock(), root, branch, folder, path })
}
