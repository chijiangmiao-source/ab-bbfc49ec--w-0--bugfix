// Exact rational arithmetic over BigInt.
// Every rational is stored as an unreduced fraction { n: numerator, d: denominator }
// with d > 0. Operations keep a common (unreduced) denominator; callers reduce only
// when canonical output is required. All computations therefore stay exact and no
// floating point is ever used.

export interface Rat {
  n: bigint;
  d: bigint; // always > 0
}

export const rFrom = (n: bigint | number, d: bigint | number = 1n): Rat => {
  const nn = BigInt(n);
  let dd = BigInt(d);
  if (dd === 0n) throw new Error('rational denominator is zero');
  return dd < 0n ? { n: -nn, d: -dd } : { n: nn, d: dd };
};

export const rNeg = (a: Rat): Rat => ({ n: -a.n, d: a.d });

export const rAdd = (a: Rat, b: Rat): Rat => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
export const rSub = (a: Rat, b: Rat): Rat => ({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
export const rMul = (a: Rat, b: Rat): Rat => ({ n: a.n * b.n, d: a.d * b.d });
export const rDiv = (a: Rat, b: Rat): Rat => {
  if (b.n === 0n) throw new Error('division by zero rational');
  const n = a.n * b.d;
  const d = a.d * b.n;
  return d < 0n ? { n: -n, d: -d } : { n, d };
};

export const rIsZero = (a: Rat): boolean => a.n === 0n;

export function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

export const rReduce = (a: Rat): Rat => {
  if (a.n === 0n) return { n: 0n, d: 1n };
  const g = gcdBig(a.n, a.d);
  return { n: a.n / g, d: a.d / g };
};

export const rEq = (a: Rat, b: Rat): boolean => a.n * b.d === b.n * a.d;
export const rCmp = (a: Rat, b: Rat): number => {
  const v = a.n * b.d - b.n * a.d;
  return v < 0n ? -1 : v > 0n ? 1 : 0;
};
