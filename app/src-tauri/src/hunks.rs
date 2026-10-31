use crate::types::{LineRange, Side};

/// The line ranges a diff's hunks cover on each side, context included.
#[derive(Debug, Default, PartialEq)]
pub struct Covered {
    pub old: Vec<(u64, u64)>,
    pub new: Vec<(u64, u64)>,
}

impl Covered {
    pub fn parse(diff: &str) -> Self {
        let mut covered = Covered::default();
        for line in diff.lines() {
            if let Some((old, new)) = hunk_header(line) {
                covered.old.push(old);
                covered.new.push(new);
            }
        }
        covered
    }

    /// Whether any of the lines lies in a hunk on that side.
    pub fn overlaps(&self, side: Side, lines: LineRange) -> bool {
        let ranges = match side {
            Side::Old => &self.old,
            Side::New => &self.new,
        };
        let (start, end) = (lines.start().get(), lines.end().get());
        ranges.iter().any(|&(from, len)| len > 0 && from <= end && start < from + len)
    }
}

/// `@@ -a[,b] +c[,d] @@` as ((a, b), (c, d)); a missing length is 1.
fn hunk_header(line: &str) -> Option<((u64, u64), (u64, u64))> {
    let rest = line.strip_prefix("@@ -")?;
    let (old, rest) = rest.split_once(" +")?;
    let (new, _) = rest.split_once(" @@")?;
    Some((range(old)?, range(new)?))
}

fn range(text: &str) -> Option<(u64, u64)> {
    match text.split_once(',') {
        Some((start, len)) => Some((start.parse().ok()?, len.parse().ok()?)),
        None => Some((text.parse().ok()?, 1)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_both_sides_and_default_lengths() {
        let covered = Covered::parse("diff --git a/x b/x\n@@ -3,2 +3 @@ fn x\n-a\n-b\n+c\n@@ -10,0 +9,4 @@\n");
        assert_eq!(covered.old, vec![(3, 2), (10, 0)]);
        assert_eq!(covered.new, vec![(3, 1), (9, 4)]);
    }

    #[test]
    fn overlap_respects_bounds_and_empty_hunks() {
        use crate::types::LineNumber;
        let lines = |a, b| LineRange::new(LineNumber::new(a).unwrap(), LineNumber::new(b).unwrap()).unwrap();
        let covered = Covered::parse("@@ -10,0 +9,4 @@\n");
        assert!(covered.overlaps(Side::New, lines(12, 20)));
        assert!(!covered.overlaps(Side::New, lines(13, 20)));
        assert!(covered.overlaps(Side::New, lines(1, 9)));
        assert!(!covered.overlaps(Side::Old, lines(10, 10)));
    }
}
