// Deterministic sample batches built around a known non-affine projectivity.
// Everything is computed exactly; generation runs entirely in the browser.

import { applyHomography, canonicalIntegers } from './homography';
import type { Homography, Point } from './homography';
import type { Correspondence } from './audit';

const INTEGER_MATRIX: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [
  300n, 100n, 10000n,
  100n, 400n, 20000n,
  1n, 2n, 1000n,
];

const homographyFromInts = (m: typeof INTEGER_MATRIX): Homography => ({
  m: m.map((v) => ({ n: v, d: 1n })) as Homography['m'],
});

/**
 * Given M = [[a,b,tx],[c,d,ty],[p,q,s]] and a desired integer image (u,v),
 * solve M*(x,y,1) = lambda*(u,v,1) exactly for integer (x,y) by scanning
 * small (u,v) and solving the resulting 2x2 linear system.
 */
function generateCleanPoints(H: Homography, wanted: number): Array<{ a: Point; b: Point }> {
  const [a, b, tx, c, d, ty, p, q, s] = INTEGER_MATRIX.map((v) => Number(v));
  const out: Array<{ a: Point; b: Point }> = [];
  const seenA = new Set<string>();
  const seenB = new Set<string>();
  // From the last row: lambda = s + p x + q y.
  // (a - p u) x + (b - q u) y = s u - tx
  // (c - p v) x + (d - q v) y = s v - ty
  for (let u = -30; u <= 60 && out.length < wanted; u++) {
    for (let v = -30; v <= 60 && out.length < wanted; v++) {
      const A11 = a - p * u;
      const A12 = b - q * u;
      const rhs1 = s * u - tx;
      const A21 = c - p * v;
      const A22 = d - q * v;
      const rhs2 = s * v - ty;
      const det = A11 * A22 - A12 * A21;
      if (det === 0) continue;
      const xNum = rhs1 * A22 - A12 * rhs2;
      const yNum = A11 * rhs2 - rhs1 * A21;
      if (xNum % det !== 0 || yNum % det !== 0) continue;
      const x = xNum / det;
      const y = yNum / det;
      if (Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000) continue;
      const ka = `${x},${y}`;
      const kb = `${u},${v}`;
      if (seenA.has(ka) || seenB.has(kb)) continue;
      // Exact verification with the BigInt engine before accepting.
      const img = applyHomography(H, { x, y });
      if (!img || img.x.n !== BigInt(u) * img.x.d || img.y.n !== BigInt(v) * img.y.d) continue;
      seenA.add(ka);
      seenB.add(kb);
      out.push({ a: { x, y }, b: { x: u, y: v } });
    }
  }
  return out;
}

export interface SampleBatch {
  text: string;
  limit: string;
  canonicalMatrix: bigint[];
  outlierIds: string[];
}

/**
 * Build a batch of 12 exact correspondences under a non-affine projectivity and
 * corrupt two of them into outliers. Returns the paste-ready table text.
 */
export function buildSample(): SampleBatch {
  const H = homographyFromInts(INTEGER_MATRIX);
  const clean = generateCleanPoints(H, 12);
  if (clean.length < 12) {
    throw new Error(`示例生成失败：仅得到 ${clean.length} 个整数像点`);
  }
  const rows: Correspondence[] = clean.map((pp, i) => ({
    id: `P${String(i + 1).padStart(2, '0')}`,
    ax: pp.a.x,
    ay: pp.a.y,
    bx: pp.b.x,
    by: pp.b.y,
  }));
  // Corrupt two points by displacing their second-side marks. The displaced
  // coordinates are chosen to stay unique on the B side.
  const outlierIds = [rows[3].id, rows[9].id];
  const usedB = new Set(rows.map((r) => `${r.bx},${r.by}`));
  for (const id of outlierIds) {
    const r = rows.find((row) => row.id === id)!;
    usedB.delete(`${r.bx},${r.by}`);
    let dx = 37;
    while (usedB.has(`${r.bx + dx},${r.by - 19}`)) dx += 11;
    r.bx += dx;
    r.by -= 19;
    usedB.add(`${r.bx},${r.by}`);
  }
  const text =
    '# 标识  X₁ Y₁  （原件/玻璃底片坐标）    X₂ Y₂  （复拍坐标）\n' +
    rows.map((r) => `${r.id}, ${r.ax}, ${r.ay}, ${r.bx}, ${r.by}`).join('\n');
  return {
    text,
    limit: '2',
    canonicalMatrix: canonicalIntegers(H),
    outlierIds,
  };
}
