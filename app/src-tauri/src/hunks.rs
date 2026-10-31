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

    /// The headers of the hunks none of `anchors` overlaps, each on its own side.
    pub fn uncovered(&self, anchors: &[(Side, LineRange)]) -> Vec<String> {
        let touches = |(from, len): (u64, u64), lines: LineRange| len > 0 && from <= lines.end().get() && lines.start().get() < from + len;
        self.old
            .iter()
            .zip(&self.new)
            .filter(|(old, new)| {
                !anchors.iter().any(|&(side, lines)| match side {
                    Side::Old => touches(**old, lines),
                    Side::New => touches(**new, lines),
                })
            })
            .map(|(&(old_start, old_len), &(new_start, new_len))| format!("@@ -{old_start},{old_len} +{new_start},{new_len} @@"))
            .collect()
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
    fn lists_hunks_no_anchor_overlaps() {
        use crate::types::LineNumber;
        let lines = |a, b| LineRange::new(LineNumber::new(a).unwrap(), LineNumber::new(b).unwrap()).unwrap();
        let covered = Covered::parse("@@ -2,3 +2,3 @@\n@@ -20,2 +19,0 @@\n@@ -40 +38,2 @@\n");
        assert_eq!(covered.uncovered(&[]).len(), 3);
        assert_eq!(covered.uncovered(&[(Side::New, lines(3, 3)), (Side::Old, lines(21, 21))]), vec!["@@ -40,1 +38,2 @@"]);
        assert_eq!(covered.uncovered(&[(Side::New, lines(19, 19))]).len(), 3);
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
