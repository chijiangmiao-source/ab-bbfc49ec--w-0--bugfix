// Input model, parsing/validation, and the exact projective-registration audit.
//
// The audit searches every non-degenerate four-point frame on the source side
// whose corresponding target quadruple is also a frame, builds the exact
// homography for it, and tests all correspondences with BigInt rational
// arithmetic. Any globally optimal inlier set contains a frame (a set of >= 4
// inliers under a genuine projectivity with no three collinear on the source
// side — a structural precondition of the task), so this enumeration is exact.

import {
  Homography,
  Point,
  cmpIntVec,
  homographyIntFromFrames,
  mapsExactlyInt,
  normalizeIntVec,
} from './homography';

export interface Correspondence {
  id: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export type FailureCode =
  | 'EMPTY'
  | 'BAD_ROW'
  | 'DUP_ID'
  | 'DUP_A'
  | 'DUP_B'
  | 'OUT_OF_RANGE'
  | 'BAD_LIMIT'
  | 'COUNT';

export interface ParseResult {
  ok: boolean;
  rows?: Correspondence[];
  error?: { code: FailureCode; line?: number; message: string };
}

const COORD_MAX = 1_000_000;

const isInt = (s: string): boolean => /^[+-]?\d+$/.test(s);

/**
 * Parse a free-form correspondence table. Each non-empty line holds one point:
 *   id, ax, ay, bx, by
 * Fields may be separated by commas, tabs, semicolons or runs of whitespace.
 * `#` starts a comment.
 */
export function parseCorrespondences(text: string): ParseResult {
  const rows: Correspondence[] = [];
  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const parts = line.split(/[\t,;]|\s+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length !== 5) {
      return {
        ok: false,
        error: {
          code: 'BAD_ROW',
          line: li + 1,
          message: `第 ${li + 1} 行字段数应为 5（标识, X₁, Y₁, X₂, Y₂），实际为 ${parts.length}。`,
        },
      };
    }
    const [id, sax, say, sbx, sby] = parts;
    if (!id) {
      return { ok: false, error: { code: 'BAD_ROW', line: li + 1, message: `第 ${li + 1} 行缺少标识。` } };
    }
    if (![sax, say, sbx, sby].every(isInt)) {
      return {
        ok: false,
        error: { code: 'BAD_ROW', line: li + 1, message: `第 ${li + 1} 行坐标必须是整数。` },
      };
    }
    const [ax, ay, bx, by] = [sax, say, sbx, sby].map((s) => Number(s));
    rows.push({ id, ax, ay, bx, by });
  }

  if (rows.length === 0) {
    return { ok: false, error: { code: 'EMPTY', message: '未读到任何对应点。' } };
  }
  if (rows.length < 8 || rows.length > 40) {
    return {
      ok: false,
      error: { code: 'COUNT', message: `每批必须包含 8 至 40 个对应点，当前为 ${rows.length} 个。` },
    };
  }
  const ids = new Set<string>();
  const sideA = new Set<string>();
  const sideB = new Set<string>();
  for (const r of rows) {
    if (ids.has(r.id)) {
      return { ok: false, error: { code: 'DUP_ID', message: `标识重复：${r.id}` } };
    }
    ids.add(r.id);
    if ([r.ax, r.ay, r.bx, r.by].some((v) => Math.abs(v) > COORD_MAX)) {
      return { ok: false, error: { code: 'OUT_OF_RANGE', message: `点 ${r.id} 的坐标绝对值超过 1,000,000。` } };
    }
    const ka = `${r.ax},${r.ay}`;
    const kb = `${r.bx},${r.by}`;
    if (sideA.has(ka)) {
      return { ok: false, error: { code: 'DUP_A', message: `第一侧坐标重复：(${r.ax}, ${r.ay})，点 ${r.id}。` } };
    }
    if (sideB.has(kb)) {
      return { ok: false, error: { code: 'DUP_B', message: `第二侧坐标重复：(${r.bx}, ${r.by})，点 ${r.id}。` } };
    }
    sideA.add(ka);
    sideB.add(kb);
  }
  return { ok: true, rows };
}

export function parseOutlierLimit(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const v = Number(t);
  return v >= 0 && v <= 4 ? v : null;
}

export interface AuditSuccess {
  ok: true;
  homography: Homography;
  canonical: bigint[];
  inlierIds: string[];
  outlierIds: string[];
  outlierCount: number;
  /** Number of distinct canonical (optimal) homographies found. */
  distinctOptimal: number;
  framesEvaluated: number;
}

export interface AuditFailure {
  ok: false;
  reason: 'NO_FRAME' | 'TOO_MANY_OUTLIERS' | 'ZERO_DENOMINATOR';
  message: string;
  bestOutlierCount: number;
  /** Correspondences whose image under the chosen best transform has denominator W = 0. */
  infinityCount: number;
  /** Identifiers of the W = 0 correspondences (same order as the input rows). */
  infinityIds: string[];
  /**
   * Canonical nine-integer vector of the chosen optimal transform (lexicographic
   * winner among the minimum-outlier candidates). Absent only for NO_FRAME.
   */
  canonical?: bigint[];
  /** Number of distinct canonical transforms attaining the minimum outlier count. */
  distinctOptimal: number;
}

export type AuditResult = AuditSuccess | AuditFailure;

const frameQuit = (p: Point[]): boolean => {
  // Four distinct points with no three collinear; distinctness is guaranteed by
  // the no-duplicate-coordinates validation for same-side points within a batch.
  const [a, b, c, d] = p;
  const cross = (p1: Point, p2: Point, p3: Point) =>
    BigInt(p2.x - p1.x) * BigInt(p3.y - p1.y) - BigInt(p2.y - p1.y) * BigInt(p3.x - p1.x);
  return (
    cross(a, b, c) !== 0n &&
    cross(a, b, d) !== 0n &&
    cross(a, c, d) !== 0n &&
    cross(b, c, d) !== 0n
  );
};

/**
 * Run the exact audit.
 *
 * @param rows validated correspondences (8..40, unique ids, no same-side dupes)
 * @param maxOutliers allowed outlier ceiling (0..4)
 */
export function runAudit(rows: Correspondence[], maxOutliers: number): AuditResult {
  const n = rows.length;
  const a: Point[] = rows.map((r) => ({ x: r.ax, y: r.ay }));
  const b: Point[] = rows.map((r) => ({ x: r.bx, y: r.by }));

  // Best state across all candidate frames.
  let bestOutliers = n + 1;
  let bestCanonical: bigint[] | null = null;
  let bestInlierMask: bigint = 0n;
  let bestInfinityMask: bigint = 0n;
  const distinctCanonical = new Set<string>();
  let framesEvaluated = 0;

  // Enumerate every source-side frame i<j<k<l.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        // first three must be non-collinear for the quadruple to be a frame;
        // pre-filter before the innermost loop.
        const cross3 =
          BigInt(a[j].x - a[i].x) * BigInt(a[k].y - a[i].y) -
          BigInt(a[j].y - a[i].y) * BigInt(a[k].x - a[i].x);
        if (cross3 === 0n) continue;
        for (let l = k + 1; l < n; l++) {
          if (!frameQuit([a[i], a[j], a[k], a[l]])) continue;
          if (!frameQuit([b[i], b[j], b[k], b[l]])) continue;
          const G = homographyIntFromFrames(
            [a[i], a[j], a[k], a[l]],
            [b[i], b[j], b[k], b[l]],
          );
          if (!G) continue;
          framesEvaluated++;
          let mask = 0n;
          let infMask = 0n;
          for (let t = 0; t < n; t++) {
            if (mapsExactlyInt(G, a[t], b[t])) {
              mask |= 1n << BigInt(t);
            } else {
              const px = BigInt(a[t].x);
              const py = BigInt(a[t].y);
              const W = G[6] * px + G[7] * py + G[8];
              if (W === 0n) infMask |= 1n << BigInt(t);
            }
          }
          const outliers = n - popcount(mask);
          // Canonicalization is the pricier BigInt step; only pay it for frames
          // that can still tie or beat the running optimum.
          if (outliers > bestOutliers) continue;
          const canon = normalizeIntVec(G);
          if (outliers < bestOutliers) {
            bestOutliers = outliers;
            bestCanonical = canon;
            bestInlierMask = mask;
            bestInfinityMask = infMask;
            distinctCanonical.clear();
            distinctCanonical.add(canon.join(','));
          } else {
            distinctCanonical.add(canon.join(','));
            if (bestCanonical === null || cmpIntVec(canon, bestCanonical) < 0) {
              bestCanonical = canon;
              bestInlierMask = mask;
              bestInfinityMask = infMask;
            }
          }
        }
      }
    }
  }

  if (bestCanonical === null) {
    return {
      ok: false,
      reason: 'NO_FRAME',
      message:
        '保留点中找不到四点射影标架（任意四个非共线点的组合，其第二侧对应点也须构成标架），无法唯一确定射影变换。',
      bestOutlierCount: n,
      infinityCount: 0,
      infinityIds: [],
      distinctOptimal: 0,
    };
  }

  const infinityIds: string[] = [];
  for (let t = 0; t < n; t++) {
    if ((bestInfinityMask >> BigInt(t)) & 1n) infinityIds.push(rows[t].id);
  }
  const infinityCount = infinityIds.length;

  // Zero denominator takes priority over the outlier allowance. A finite
  // correspondence whose image under the chosen minimum-outlier transform has
  // W = 0 cannot be judged at all (no finite image to compare), so spending an
  // allowed outlier slot on it must never turn the audit into a success — even
  // when the minimum outlier count fits within the ceiling.
  if (infinityCount > 0) {
    return {
      ok: false,
      reason: 'ZERO_DENOMINATOR',
      message:
        `最优射影变换（最少离群 ${bestOutliers} 个）令 ${infinityCount} 个有限对应点的齐次分母 W = 0` +
        `（像落在无穷远，无法映射为有限像）：${infinityIds.join('、')}。` +
        '分母为零的点不能以离群名额剔除后判为成功。',
      bestOutlierCount: bestOutliers,
      infinityCount,
      infinityIds,
      canonical: bestCanonical,
      distinctOptimal: distinctCanonical.size,
    };
  }

  if (bestOutliers > maxOutliers) {
    return {
      ok: false,
      reason: 'TOO_MANY_OUTLIERS',
      message: `最少仍有 ${bestOutliers} 个离群点，超过允许上限 ${maxOutliers}。`,
      bestOutlierCount: bestOutliers,
      infinityCount: 0,
      infinityIds: [],
      canonical: bestCanonical,
      distinctOptimal: distinctCanonical.size,
    };
  }

  const inlierIds: string[] = [];
  const outlierIds: string[] = [];
  for (let t = 0; t < n; t++) {
    if ((bestInlierMask >> BigInt(t)) & 1n) inlierIds.push(rows[t].id);
    else outlierIds.push(rows[t].id);
  }

  // Rebuild the exact rational matrix from the chosen canonical vector so that
  // matrix display and overlay come from one consistent source.
  const homography: Homography = {
    m: bestCanonical.map((v) => ({ n: v, d: 1n })) as Homography['m'],
  };

  return {
    ok: true,
    homography,
    canonical: bestCanonical,
    inlierIds,
    outlierIds,
    outlierCount: bestOutliers,
    distinctOptimal: distinctCanonical.size,
    framesEvaluated,
  };
}

function popcount(x: bigint): number {
  let v = x;
  let c = 0;
  while (v !== 0n) {
    v &= v - 1n;
    c++;
  }
  return c;
}
