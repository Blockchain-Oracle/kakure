//! The house's public price (plan §00 REVAMP 2): Mitoshi's fair value `P(Up) = Φ(ln(S/O) / (σ√τ))`
//! (`crypto-world-fair/packages/core/src/fair/fair.ts`) with a published spread. Mirrors the
//! `@kakure/domain` constants; the formula and its shared vectors arrive with trading (T3).
//! Every input is published in each bundle, so anyone can recompute any quote.

/// The fair price never uses less time left than this (Agari/Mitoshi `MIN_SECONDS_LEFT`).
pub const MIN_TAU_SECS: i64 = 5;
/// Half the spread around the fair price, and the bounds an ask stays inside (fractions of 1).
pub const HALF_SPREAD: &str = "0.025";
pub const MIN_ASK: &str = "0.02";
pub const MAX_ASK: &str = "0.98";
