use super::Failure;
use crate::git;
use crate::types::{BranchName, CommitId, RepoRoot, TourPath, ToursFolder};
use std::path::{Path, PathBuf};

/// What a tour is about, filled in by the generator rather than the agent.
#[derive(Clone, Debug)]
pub struct Facts {
    pub root: RepoRoot,
    pub branch: BranchName,
    pub base: BranchName,
    pub base_sha: CommitId,
    pub head_sha: CommitId,
    pub tour_path: TourPath,
}

/// The branch (default: checked out), its base (default: develop, else main,
/// else master) and their merge base.
pub async fn resolve(repo: &Path, branch: Option<BranchName>, base: Option<BranchName>) -> Result<Facts, Failure> {
    let root = git::text(repo, &["rev-parse", "--show-toplevel"]).await?;
    let root = RepoRoot::try_from(PathBuf::from(root.trim()))?;
    let at = root.as_path();
    let branch = match branch {
        Some(branch) => branch,
        None => {
            let current = git::run(at, &["symbolic-ref", "--short", "-q", "HEAD"]).await?;
            BranchName::try_from(current.text().trim()).map_err(|_| Failure::from("detached HEAD: name the branch to tour"))?
        }
    };
    let head = git::text(at, &["rev-parse", "--verify", &format!("{branch}^{{commit}}")]).await?;
    let head_sha = CommitId::try_from(head.trim())?;
    let (base, base_ref) = match base {
        Some(base) => {
            let found = branch_ref(at, &base).await?;
            let base_ref = found.ok_or_else(|| Failure(format!("base branch {base} not found locally or on a remote")))?;
            (base, base_ref)
        }
        // Not the remote's default branch: it can differ from where work merges.
        None => default_base(at).await?.ok_or("no develop, main or master branch: pass --base")?,
    };
    let merge_base = git::text(at, &["merge-base", &base_ref, head_sha.as_str()]).await?;
    let base_sha = CommitId::try_from(merge_base.trim())?;
    let common = git::text(at, &["rev-parse", "--path-format=absolute", "--git-common-dir"]).await?;
    let folder = ToursFolder::try_from(PathBuf::from(common.trim()).join("pr-tours"))?;
    let tour_path = folder.tour_for(&branch);
    Ok(Facts { root, branch, base, base_sha, head_sha, tour_path })
}

async fn default_base(root: &Path) -> Result<Option<(BranchName, String)>, Failure> {
    for name in ["develop", "main", "master"] {
        let name = BranchName::try_from(name)?;
        if let Some(found) = branch_ref(root, &name).await? {
            return Ok(Some((name, found)));
        }
    }
    Ok(None)
}

/// The local branch, else the first remote's copy of it, else None.
async fn branch_ref(root: &Path, name: &BranchName) -> Result<Option<String>, Failure> {
    let remotes = git::text(root, &["remote"]).await?;
    let candidates = std::iter::once(name.to_string()).chain(remotes.split_whitespace().map(|remote| format!("{remote}/{name}")));
    for candidate in candidates {
        if ref_exists(root, &candidate).await {
            return Ok(Some(candidate));
        }
    }
    Ok(None)
}

async fn ref_exists(root: &Path, candidate: &str) -> bool {
    let commit = format!("{candidate}^{{commit}}");
    git::run(root, &["rev-parse", "--verify", "-q", &commit]).await.is_ok_and(|o| o.success)
}
