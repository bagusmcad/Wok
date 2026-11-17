// Extra per-protocol signals for the token radar, derived only from the sealed
// snapshot's own figures. Every function here is pure and deterministic: the same
// snapshot in always gives the same numbers out, with no clock, no randomness and
// no network. The signals sit beside the ranking model in lib/model.ts; they never
// change a row's rank or implied value, they only describe each protocol so the
// board can show more than a single number per row.

import type { SnapshotProtocol } from './model.ts';

/** How one category looks across the whole snapshot: its size and its middles. */
export interface CategoryStats {
  category: string;
  count: number;
  medianTvl: number;
  medianGrowth: number | null;
}

/** The five signals the board carries for one protocol, each scored 0 to 100. */
export interface ProtocolSignals {
  /** TVL against the median TVL of the protocol's own category. */
  quality: number;
  /** Seven-day TVL change, mapped so flat is neutral and a steep fall scores low. */
  momentum: number;
  /** How spread the protocol is across chains, with diminishing returns per chain. */
  breadth: number;
  /** How complete the snapshot's record of this protocol is. */
  confidence: number;
  /** The category-relative strength: quality, momentum and breadth in one number. */
  strength: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[mid]!;
  return (ordered[mid - 1]! + ordered[mid]!) / 2;
}

/** The bucket a protocol with no category lands in, so it still gets a comparison. */
export const UNCATEGORISED = 'Other';

/**
 * One stats row per category present in the snapshot, keyed by category name.
 * The median TVL is the middle of the category's protocols by locked value; the
 * median growth is the middle of the seven-day changes that were actually
 * reported, so a category with no reported change carries null, not zero.
 */
export function computeCategoryStats(protocols: SnapshotProtocol[]): Map<string, CategoryStats> {
  const byCategory = new Map<string, SnapshotProtocol[]>();
  for (const p of protocols) {
    const key = p.category ?? UNCATEGORISED;
    const bucket = byCategory.get(key);
    if (bucket === undefined) byCategory.set(key, [p]);
    else bucket.push(p);
  }
  const stats = new Map<string, CategoryStats>();
  for (const [category, members] of byCategory) {
    const medianTvl = median(members.map((p) => p.tvl_usd)) ?? 0;
    const reported = members
      .map((p) => p.change_7d)
      .filter((g): g is number => g !== null && Number.isFinite(g));
    stats.set(category, {
      category,
      count: members.length,
      medianTvl,
      medianGrowth: median(reported),
    });
  }
  return stats;
}

/**
 * TVL quality: the protocol's locked value against its category's median, on a
 * curve that scores the median itself at 50, ten times the median near 91, and
 * a tenth of the median near 9. A category whose median is zero scores neutral.
 */
export function tvlQualityScore(protocol: SnapshotProtocol, stats: Map<string, CategoryStats>): number {
  const row = stats.get(protocol.category ?? UNCATEGORISED);
  if (row === undefined || row.medianTvl <= 0) return 50;
  const ratio = protocol.tvl_usd / row.medianTvl;
  return Math.round(100 * (ratio / (ratio + 1)));
}

/**
 * Momentum: the seven-day change in per cent, centred so no change scores 50,
 * each 4 points of growth adds one point, and the ends are capped. A protocol
 * with no change reported scores neutral rather than zero, because silence is
 * not a fall. A 4448% spike still caps at 100.
 */
export function momentumScore(protocol: SnapshotProtocol): number {
  if (protocol.change_7d === null || !Number.isFinite(protocol.change_7d)) return 50;
  return clamp(Math.round(50 + protocol.change_7d / 4), 0, 100);
}

/**
 * Chain breadth: one chain scores 25, and each extra chain adds less than the
 * last, so a protocol on ten chains scores in the high seventies and one on a
 * hundred and seventy-six still stops below 100. Breadth is diversification,
 * not size: a giant on one chain scores low here.
 */
export function chainBreadthScore(protocol: SnapshotProtocol): number {
  const n = protocol.chains.length;
  return Math.round(100 * (n / (n + 3)));
}

/**
 * Record confidence: the snapshot's record of a protocol is worth more when it
 * is complete. A missing listing date costs 20, a missing seven-day change
 * costs 15, and a missing category costs 5, so a fully recorded protocol
 * scores 100 and the thinnest record still scores above 50.
 */
export function recordConfidenceScore(protocol: SnapshotProtocol): number {
  let score = 100;
  if (protocol.listed_at === null) score -= 20;
  if (protocol.change_7d === null) score -= 15;
  if (protocol.category === null) score -= 5;
  return clamp(score, 0, 100);
}

/**
 * All five signals for one protocol. Strength weights quality most, because a
 * launch's value starts from locked value, then momentum, then breadth.
 */
export function computeSignals(protocol: SnapshotProtocol, stats: Map<string, CategoryStats>): ProtocolSignals {
  const quality = tvlQualityScore(protocol, stats);
  const momentum = momentumScore(protocol);
  const breadth = chainBreadthScore(protocol);
  const confidence = recordConfidenceScore(protocol);
  const strength = Math.round(0.45 * quality + 0.3 * momentum + 0.25 * breadth);
  return { quality, momentum, breadth, confidence, strength };
}

/** A one-word reading of a strength score, for the board's Risk column and tooltips. */
export function strengthLabel(strength: number): string {
  if (strength >= 75) return 'strong';
  if (strength >= 55) return 'firm';
  if (strength >= 40) return 'mixed';
  return 'weak';
}

/**
 * A short sentence naming what carries a protocol's strength, used in the detail
 * view so a reader can see which signal does the work instead of trusting a
 * bare number.
 */
export function signalsSummary(protocol: SnapshotProtocol, signals: ProtocolSignals): string {
  const parts: string[] = [];
  if (signals.quality >= 70) parts.push('large for its category');
  else if (signals.quality <= 30) parts.push('small for its category');
  if (signals.momentum >= 70) parts.push('growing fast over seven days');
  else if (signals.momentum <= 30) parts.push('shrinking over seven days');
  if (signals.breadth >= 60) parts.push('spread across many chains');
  else if (signals.breadth <= 30) parts.push('on a single chain');
  if (parts.length === 0) return 'An ordinary record: middling size, growth and breadth for its category.';
  return `This protocol is ${parts.join(', ')}.`;
}
