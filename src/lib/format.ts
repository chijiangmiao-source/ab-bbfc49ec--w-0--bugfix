// Display helpers for exact values. These are presentation-only: every verdict
// is produced upstream with BigInt arithmetic.

import { Rat, rReduce } from './rat';

export function ratToText(r: Rat): string {
  const v = rReduce(r);
  return v.d === 1n ? v.n.toString() : `${v.n}/${v.d}`;
}

/** Decimal value for geometry drawing (SVG) only. */
export function ratToNumber(r: Rat): number {
  return Number(r.n) / Number(r.d);
}

export function bigToText(v: bigint): string {
  const neg = v < 0n;
  const digits = (neg ? -v : v).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? `-${grouped}` : grouped;
}
