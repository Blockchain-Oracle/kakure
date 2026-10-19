//! Which pending tickets a bundle may publish (PD28, per side).
//!
//! Once a market's odds are unsealed, the bundle shows each side's ticket count and total. If one
//! release mixed sides (say two Up tickets and one Down), the Down total would grow by exactly one
//! ticket and anyone diffing two bundles would learn that ticket's size. So a side's pending tickets
//! are published only together with at least `min` pending tickets *of the same side*; every change
//! to a side's count or total then covers at least `min` tickets. Tickets on a side that never
//! reaches `min` stay pending and are refunded in full at the final freeze, never counted.

use std::collections::BTreeMap;

/// A pending ticket: `(side, size_zat, leaf)`.
pub type Pending = (String, u64, String);

/// The pending tickets to publish now: every side with at least `min` pending, whole; nothing else.
pub fn releasable(pending: Vec<Pending>, min: usize) -> Vec<Pending> {
    let mut by_side: BTreeMap<String, Vec<Pending>> = BTreeMap::new();
    for ticket in pending {
        by_side.entry(ticket.0.clone()).or_default().push(ticket);
    }
    by_side
        .into_values()
        .filter(|side| side.len() >= min)
        .flatten()
        .collect()
}

/// The most tickets that may legitimately remain unreleased on one side at the final freeze.
pub fn max_unreleased_per_side(min: usize) -> usize {
    min.saturating_sub(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: usize = 3;

    fn t(side: &str, size: u64, leaf: &str) -> Pending {
        (side.to_string(), size, leaf.to_string())
    }

    #[test]
    fn mixed_group_does_not_release_the_lone_side() {
        let out = releasable(vec![t("U", 1, "a"), t("U", 2, "b"), t("D", 5, "c")], MIN);
        assert!(
            out.is_empty(),
            "2 Up + 1 Down: neither side has 3, nothing is published"
        );
    }

    #[test]
    fn full_side_releases_alone_and_the_short_side_waits() {
        let out = releasable(
            vec![
                t("U", 1, "a"),
                t("U", 2, "b"),
                t("U", 3, "c"),
                t("D", 5, "d"),
            ],
            MIN,
        );
        let leaves: Vec<&str> = out.iter().map(|(_, _, l)| l.as_str()).collect();
        assert_eq!(
            leaves,
            ["a", "b", "c"],
            "only the Up side (3 tickets) is published"
        );
        assert!(out.iter().all(|(s, _, _)| s == "U"));
    }

    #[test]
    fn both_sides_release_when_each_has_enough() {
        let pending: Vec<Pending> = ["U", "U", "U", "D", "D", "D"]
            .iter()
            .enumerate()
            .map(|(i, s)| t(s, 1, &i.to_string()))
            .collect();
        assert_eq!(releasable(pending, MIN).len(), 6);
    }

    #[test]
    fn a_whole_side_goes_out_together() {
        let pending: Vec<Pending> = (0..5).map(|i| t("Y", 1, &i.to_string())).collect();
        assert_eq!(
            releasable(pending, MIN).len(),
            5,
            "more than the minimum is released in full"
        );
    }

    #[test]
    fn freeze_bound_per_side() {
        assert_eq!(max_unreleased_per_side(MIN), 2);
    }
}
