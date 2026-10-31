//! The reviewer's notes on a branch: what should change, and remarks. Kept per
//! branch next to its tour, so they outlive new commits and new tours.

use crate::files::{now, random_id, read_json, update_json};
use crate::generate::Failure;
use crate::types::{CommitId, LineNumber, NoteId, RepoFile, ReviewPath, Side, StepId};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Review {
    pub version: u32,
    #[serde(default)]
    pub notes: Vec<Note>,
}

impl Default for Review {
    fn default() -> Self {
        Review { version: 1, notes: Vec::new() }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Note {
    pub id: NoteId,
    pub step: StepId,
    /// The commit reviewed when the note was written; its lines refer to it.
    pub head_sha: CommitId,
    pub kind: NoteKind,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lines: Option<NoteLines>,
    pub status: NoteStatus,
    pub created_at: String,
    /// When the note was last copied for the author.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sent_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteKind {
    /// Something the author should change.
    Change,
    /// Something to know, no action needed.
    Remark,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteStatus {
    Open,
    Resolved,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NoteLines {
    pub file: RepoFile,
    pub side: Side,
    pub start: LineNumber,
    pub end: LineNumber,
}

/// One change to the review, as the app asks for it.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum ReviewChange {
    Add { step: StepId, head_sha: CommitId, kind: NoteKind, text: String, lines: Option<NoteLines> },
    Edit { id: NoteId, text: String },
    Resolve { id: NoteId, resolved: bool },
    Delete { id: NoteId },
    /// The notes were copied for the author.
    Sent { ids: Vec<NoteId> },
}

pub async fn read(path: &ReviewPath) -> Review {
    read_json(path.as_path()).await
}

pub async fn change(path: &ReviewPath, change: ReviewChange) -> Result<(), Failure> {
    if let ReviewChange::Add { text, .. } | ReviewChange::Edit { text, .. } = &change {
        if text.trim().is_empty() {
            return Err("a note needs text".into());
        }
    }
    update_json(path.as_path(), path.write_lock(), |review: &mut Review| apply(review, change)).await
}

fn apply(review: &mut Review, change: ReviewChange) {
    let find = |notes: &mut Vec<Note>, id: &NoteId| notes.iter_mut().position(|n| n.id == *id);
    match change {
        ReviewChange::Add { step, head_sha, kind, text, lines } => review.notes.push(Note {
            id: NoteId::try_from(random_id()).expect("hex"),
            step,
            head_sha,
            kind,
            text: text.trim().to_owned(),
            lines,
            status: NoteStatus::Open,
            created_at: now(),
            sent_at: None,
            resolved_at: None,
        }),
        ReviewChange::Edit { id, text } => {
            if let Some(at) = find(&mut review.notes, &id) {
                review.notes[at].text = text.trim().to_owned();
            }
        }
        ReviewChange::Resolve { id, resolved } => {
            if let Some(at) = find(&mut review.notes, &id) {
                let note = &mut review.notes[at];
                note.status = if resolved { NoteStatus::Resolved } else { NoteStatus::Open };
                note.resolved_at = resolved.then(now);
            }
        }
        ReviewChange::Delete { id } => review.notes.retain(|n| n.id != id),
        ReviewChange::Sent { ids } => {
            let sent = now();
            for note in review.notes.iter_mut().filter(|n| ids.contains(&n.id)) {
                note.sent_at = Some(sent.clone());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn added(review: &mut Review, text: &str) -> NoteId {
        let change: ReviewChange = serde_json::from_value(serde_json::json!({
            "op": "add", "step": "parse-diff", "head_sha": "2c144b9", "kind": "change", "text": text,
            "lines": { "file": "src/a.rs", "side": "new", "start": 3, "end": 4 }
        }))
        .unwrap();
        apply(review, change);
        review.notes.last().unwrap().id.clone()
    }

    #[test]
    fn adds_resolves_reopens_and_deletes_notes() {
        let mut review = Review::default();
        let id = added(&mut review, "  Rename this  ");
        assert_eq!(review.notes[0].text, "Rename this");
        assert_eq!(review.notes[0].lines.as_ref().unwrap().start.get(), 3);

        apply(&mut review, ReviewChange::Resolve { id: id.clone(), resolved: true });
        assert_eq!(review.notes[0].status, NoteStatus::Resolved);
        assert!(review.notes[0].resolved_at.is_some());

        apply(&mut review, ReviewChange::Resolve { id: id.clone(), resolved: false });
        assert_eq!((review.notes[0].status, review.notes[0].resolved_at.as_ref()), (NoteStatus::Open, None));

        apply(&mut review, ReviewChange::Sent { ids: vec![id.clone()] });
        assert!(review.notes[0].sent_at.is_some());

        apply(&mut review, ReviewChange::Delete { id });
        assert!(review.notes.is_empty());
    }

    #[test]
    fn line_zero_is_not_a_line() {
        let change = serde_json::from_value::<ReviewChange>(serde_json::json!({
            "op": "add", "step": "s", "head_sha": "2c144b9", "kind": "remark", "text": "x",
            "lines": { "file": "a", "side": "new", "start": 0, "end": 1 }
        }));
        assert!(change.is_err());
    }
}
