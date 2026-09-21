// Exact construction of the unique projectivity (plane homography) that maps a
// non-degenerate projective frame of four points onto another such frame.
//
// A projective frame is four points with no three collinear. For input points
// P1..P4 there exist unique (up to a common scale) homogeneous lifts with
// P4 = P1 + P2 + P3. These lifts are integer linear combinations of the raw
// lifted points: if adj(M) (M = [p1 p2 p3], cofactor adjugate, exact integers)
// gives the barycentric coordinates of p4, i.e.
//
//   M^-1 p4 = (q1/d, q2/d, q3/d)   with  (q1,q2,q3)^T = adj(M) * p4,
//
// then the frame lift matrix is  L = M * diag(q1, q2, q3) / d, so an integral
// representative is  M * diag(q1,q2,q3). The homography mapping frame A onto
// frame B is then represented by  L_B * L_A^{-1}; we accumulate everything
// over BigInt rationals.
//
// Coordinates are bounded by 1e6, so all intermediate integers stay well
// within BigInt's capacity (determinants of 3x3 matrices of lifts with entries
// O(1e8) are O(1e24)).

import { Rat, rAdd, rDiv, rFrom, rMul, rReduce, rSub } from './rat';

export interface Point {
  x: number;
  y: number;
}

/** 3-vector in homogeneous coordinates. */
export type Vec3 = [bigint, bigint, bigint];
/** 3x3 matrix in row-major order: m[row*3+col]. */
export type Mat3 = [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

export interface Homography {
  /** Rational 3x3 matrix, row-major; defined up to a non-zero scalar. */
  m: [Rat, Rat, Rat, Rat, Rat, Rat, Rat, Rat, Rat];
}

const lift = (p: Point): Vec3 => [BigInt(p.x), BigInt(p.y), 1n];

export function det3(a: Mat3 | bigint[], r0 = 0, c0 = 0, stride = 3): bigint {
  // generic helper (currently unused for arbitrary offsets but kept simple):
  const at = (r: number, c: number) => a[(r0 + r) * stride + (c0 + c)];
  return (
    at(0, 0) * at(1, 1) * at(2, 2) +
    at(0, 1) * at(1, 2) * at(2, 0) +
    at(0, 2) * at(1, 0) * at(2, 1) -
    at(0, 2) * at(1, 1) * at(2, 0) -
    at(0, 1) * at(1, 0) * at(2, 2) -
    at(0, 0) * at(1, 2) * at(2, 1)
  );
}

/** Determinant with columns given by three homogeneous vectors. */
function detCols(c0: Vec3, c1: Vec3, c2: Vec3): bigint {
  return (
    c0[0] * (c1[1] * c2[2] - c1[2] * c2[1]) -
    c1[0] * (c0[1] * c2[2] - c0[2] * c2[1]) +
    c2[0] * (c0[1] * c1[2] - c0[2] * c1[1])
  );
}

/**
 * Cofactor adjugate of the 3x3 matrix whose columns are c0,c1,c2.
 * Satisfies adj(M) * M = det(M) * I. Returned row-major.
 */
function adjCols(c0: Vec3, c1: Vec3, c2: Vec3): Mat3 {
  // M = [c0 c1 c2]
  const [a0, a1, a2] = c0;
  const [b0, b1, b2] = c1;
  const [c00, c01, c02] = c2;
  // m_rc below are the signed cofactors of M. The adjugate adj(M) = C^T has
  // entry (i,j) = cofactor (j,i), so in row-major order it is exactly
  // [C00, C10, C20, C01, C11, C21, C02, C12, C22].
  const C00 = b1 * c02 - b2 * c01;
  const C10 = b2 * c00 - b0 * c02;
  const C20 = b0 * c01 - b1 * c00;
  const C01 = a2 * c01 - a1 * c02;
  const C11 = a0 * c02 - a2 * c00;
  const C21 = a1 * c00 - a0 * c01;
  const C02 = a1 * b2 - a2 * b1;
  const C12 = a2 * b0 - a0 * b2;
  const C22 = a0 * b1 - a1 * b0;
  return [
    C00, C10, C20,
    C01, C11, C21,
    C02, C12, C22,
  ];
}

/**
 * Integral frame-lift matrix L (columns are the canonical lifts of P1..P4).
 * Returns null when the four points are not a projective frame (three collinear).
 */
export function frameLift(p1: Point, p2: Point, p3: Point, p4: Point): Mat3 | null {
  const c0 = lift(p1);
  const c1 = lift(p2);
  const c2 = lift(p3);
  const det = detCols(c0, c1, c2);
  if (det === 0n) return null; // first three collinear / coincident
  const adj = adjCols(c0, c1, c2);
  const p4v = lift(p4);
  // q = adj(M) * p4  (matrix row-major times vector)
  const q: Vec3 = [
    adj[0] * p4v[0] + adj[1] * p4v[1] + adj[2] * p4v[2],
    adj[3] * p4v[0] + adj[4] * p4v[1] + adj[5] * p4v[2],
    adj[6] * p4v[0] + adj[7] * p4v[1] + adj[8] * p4v[2],
  ];
  // q_i/d are the barycentric coordinates of p4; the frame is non-degenerate
  // iff every q_i != 0 (p4 lies on none of the three frame lines).
  if (q[0] === 0n || q[1] === 0n || q[2] === 0n) return null;
  // L = M * diag(q0, q1, q2); columns are c_i scaled by q_i.
  return [
    c0[0] * q[0], c1[0] * q[1], c2[0] * q[2],
    c0[1] * q[0], c1[1] * q[1], c2[1] * q[2],
    c0[2] * q[0], c1[2] * q[1], c2[2] * q[2],
  ];
}

/** Adjugate of a general integer 3x3 matrix (row-major). */
function adjMat(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const C: Mat3 = [
    e * i - f * h, f * g - d * i, d * h - e * g,
    c * h - b * i, a * i - c * g, b * g - a * h,
    b * f - c * e, c * d - a * f, a * e - b * d,
  ];
  return [C[0], C[3], C[6], C[1], C[4], C[7], C[2], C[5], C[8]];
}

function detMat(m: Mat3): bigint {
  const [a, b, c, d, e, f, g, h, i] = m;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/**
 * Integer matrix representative of the frame-to-frame projectivity:
 *   G = L_B * adj(L_A).
 * G is a non-zero scalar multiple (1/det L_A) of H = L_B * L_A^{-1}, hence it
 * defines the identical projectivity while requiring no rational arithmetic.
 */
export function homographyIntFromFrames(
  a: [Point, Point, Point, Point],
  b: [Point, Point, Point, Point],
): bigint[] | null {
  const LA = frameLift(...a);
  const LB = frameLift(...b);
  if (!LA || !LB) return null;
  const adjA = adjMat(LA);
  if (detMat(LA) === 0n) return null;
  const G: bigint[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let num = 0n;
      for (let k = 0; k < 3; k++) num += LB[r * 3 + k] * adjA[k * 3 + c];
      G.push(num);
    }
  }
  return G;
}

/**
 * Exact homography mapping the A-frame onto the B-frame:
 *   H = L_B * L_A^{-1} = L_B * adj(L_A) / det(L_A).
 * All nine entries are returned as exact rationals.
 */
export function homographyFromFrames(
  a: [Point, Point, Point, Point],
  b: [Point, Point, Point, Point],
): Homography | null {
  const LA = frameLift(...a);
  const LB = frameLift(...b);
  if (!LA || !LB) return null;
  const adjA = adjMat(LA);
  const detA = detMat(LA);
  if (detA === 0n) return null; // defensive: frame lifts are always invertible
  const m: Rat[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let num = 0n;
      for (let k = 0; k < 3; k++) num += LB[r * 3 + k] * adjA[k * 3 + c];
      m.push(rFrom(num, detA));
    }
  }
  return { m: m as Homography['m'] };
}

/**
 * Apply H to a finite point exactly. Returns null if the image lands on the
 * line at infinity (denominator w = 0).
 */
export function applyHomography(H: Homography, p: Point): { x: Rat; y: Rat } | null {
  const x = BigInt(p.x);
  const y = BigInt(p.y);
  const w = rAdd(rAdd(rMul(H.m[6], rFrom(x)), rMul(H.m[7], rFrom(y))), H.m[8]);
  if (w.n === 0n) return null;
  const X = rAdd(rAdd(rMul(H.m[0], rFrom(x)), rMul(H.m[1], rFrom(y))), H.m[2]);
  const Y = rAdd(rAdd(rMul(H.m[3], rFrom(x)), rMul(H.m[4], rFrom(y))), H.m[5]);
  return { x: rDiv(X, w), y: rDiv(Y, w) };
}

/**
 * Exact correspondence test. Returns true iff the image of `src` under H is the
 * finite affine point `dst`.
 */
export function mapsExactly(H: Homography, src: Point, dst: Point): boolean {
  const img = applyHomography(H, src);
  if (!img) return false;
  const dx = rSub(img.x, rFrom(BigInt(dst.x)));
  const dy = rSub(img.y, rFrom(BigInt(dst.y)));
  return dx.n === 0n && dy.n === 0n;
}

/**
 * Exact correspondence test against an integer matrix representative (e.g. the
 * output of {@link canonicalIntegers}; any non-zero scalar multiple of H gives
 * the same projective map). For G*(x,y,1) = (X,Y,W) the point is an exact
 * finite match with (u,v) iff W != 0 and X = uW and Y = vW. Pure-integer
 * arithmetic keeps a 40-frame / 91k-candidate audit fast.
 */
export function mapsExactlyInt(
  G: readonly bigint[],
  src: Point,
  dst: Point,
): boolean {
  const x = BigInt(src.x);
  const y = BigInt(src.y);
  const W = G[6] * x + G[7] * y + G[8];
  if (W === 0n) return false;
  const X = G[0] * x + G[1] * y + G[2];
  const Y = G[3] * x + G[4] * y + G[5];
  return X === BigInt(dst.x) * W && Y === BigInt(dst.y) * W;
}

/**
 * Canonical integer form of a homography: clear denominators by the LCM of the
 * nine denominators, divide by the gcd of all nine integers, and normalize sign
 * by the first non-zero entry (row-major order). The result is the unique
 * nine-integer representative of the projective equivalence class [H] in P^8(Q).
 */
export function canonicalIntegers(H: Homography): bigint[] {
  const reduced = H.m.map(rReduce);
  const gcd0 = (u: bigint, v: bigint) => {
    let x = u < 0n ? -u : u;
    let y = v < 0n ? -v : v;
    while (y) [x, y] = [y, x % y];
    return x;
  };
  let L = 1n;
  for (const r of reduced) L = (L * r.d) / gcd0(L, r.d);
  const ints = reduced.map((r) => r.n * (L / r.d));
  return normalizeIntVec(ints);
}

/**
 * Canonical form of an all-integer representative (gcd-primitive, sign fixed by
 * the leading non-zero entry in row-major order).
 */
export function normalizeIntVec(ints: bigint[]): bigint[] {
  const gcd0 = (u: bigint, v: bigint) => {
    let x = u < 0n ? -u : u;
    let y = v < 0n ? -v : v;
    while (y) [x, y] = [y, x % y];
    return x;
  };
  let g = 0n;
  for (const v of ints) g = gcd0(g, v);
  if (g === 0n) throw new Error('canonical form of zero matrix requested');
  const out = ints.map((v) => v / g);
  const first = out.find((v) => v !== 0n)!;
  if (first < 0n) for (let i = 0; i < 9; i++) out[i] = -out[i];
  return out;
}

/** Lexicographic comparison of nine-integer vectors. */
export function cmpIntVec(a: bigint[], b: bigint[]): number {
  for (let i = 0; i < 9; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

export const isFrame = (p: [Point, Point, Point, Point]): boolean => frameLift(...p) !== null;
