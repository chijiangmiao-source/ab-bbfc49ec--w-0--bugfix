import { describe, expect, it } from 'vitest';
import {
  parseCorrespondences,
  parseOutlierLimit,
  runAudit,
  type Correspondence,
} from './audit';
import { buildSample } from './sample';
import { mapsExactly, type Homography, type Point } from './homography';

const row = (id: string, a: Point, b: Point): Correspondence => ({
  id,
  ax: a.x,
  ay: a.y,
  bx: b.x,
  by: b.y,
});

describe('parser validation', () => {
  const base = (): string => {
    const pts: Point[] = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 3 },
      { x: 4, y: 5 }, { x: 6, y: 7 }, { x: 8, y: 9 }, { x: 10, y: 11 },
    ];
    return pts.map((p, i) => `P${i}, ${p.x}, ${p.y}, ${p.x + 1}, ${p.y}`).join('\n');
  };

  it('accepts a well-formed 8-point batch', () => {
    expect(parseCorrespondences(base()).ok).toBe(true);
  });

  it('rejects fewer than 8 and more than 40 points', () => {
    const seven = Array.from({ length: 7 }, (_, i) => `P${i}, ${i}, 0, ${i}, 1`).join('\n');
    expect(parseCorrespondences(seven).error?.code).toBe('COUNT');
    const fortyOne = Array.from({ length: 41 }, (_, i) => `P${i}, ${i}, 0, ${i}, 1`).join('\n');
    expect(parseCorrespondences(fortyOne).error?.code).toBe('COUNT');
  });

  it('rejects non-integer or malformed coordinates', () => {
    const t = base().replace('P0, 0, 0', 'P0, 0.5, 0');
    expect(parseCorrespondences(t).error?.code).toBe('BAD_ROW');
    const t2 = '# only comment\n\n';
    expect(parseCorrespondences(t2).error?.code).toBe('EMPTY');
  });

  it('rejects duplicate identifiers', () => {
    const t = base().replace('P1,', 'P0,');
    expect(parseCorrespondences(t).error?.code).toBe('DUP_ID');
  });

  it('rejects duplicate coordinates on each side separately', () => {
    const t = base() + '\nPX, 0, 0, 50, 50'; // A-side dup with P0
    expect(parseCorrespondences(t).error?.code).toBe('DUP_A');
    const t2 = base() + '\nPX, 50, 50, 1, 0'; // B-side dup with P0 -> (1,0)
    expect(parseCorrespondences(t2).error?.code).toBe('DUP_B');
  });

  it('rejects coordinates beyond one million', () => {
    const t = base().replace('P0, 0, 0, 1, 0', 'P0, 1000001, 0, 1, 0');
    expect(parseCorrespondences(t).error?.code).toBe('OUT_OF_RANGE');
    const ok = base().replace('P0, 0, 0, 1, 0', 'P0, -1000000, 0, 1, 0');
    expect(parseCorrespondences(ok).ok).toBe(true);
  });

  it('accepts comments and varied separators', () => {
    const t = [
      '# leading comment',
      'P0\t0\t0\t1\t0',
      'P1; 1; 0; 2; 0',
      'P2,0,1,1,1   # trailing comment',
      ...Array.from({ length: 5 }, (_, i) => `P${i + 3}, ${i + 3}, 2, ${i + 3}, 3`),
    ].join('\n');
    expect(parseCorrespondences(t).ok).toBe(true);
  });

  it('validates the outlier limit range', () => {
    expect(parseOutlierLimit('0')).toBe(0);
    expect(parseOutlierLimit('4')).toBe(4);
    expect(parseOutlierLimit('5')).toBeNull();
    expect(parseOutlierLimit('-1')).toBeNull();
    expect(parseOutlierLimit('')).toBeNull();
    expect(parseOutlierLimit('2.0')).toBeNull();
  });
});

describe('runAudit exact criteria', () => {
  it('recovers the sample batch: exact matrix and two planted outliers', () => {
    const sample = buildSample();
    const parsed = parseCorrespondences(sample.text);
    expect(parsed.ok).toBe(true);
    const res = runAudit(parsed.rows!, 2);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.outlierCount).toBe(2);
    expect(res.outlierIds.slice().sort()).toEqual(sample.outlierIds.slice().sort());
    expect(res.canonical.map(String)).toEqual(sample.canonicalMatrix.map(String));
    expect(res.distinctOptimal).toBe(1);
  });

  it('is deterministic: repeated runs agree on matrix and partition', () => {
    const sample = buildSample();
    const parsed = parseCorrespondences(sample.text).rows!;
    const r1 = runAudit(parsed, 2);
    const r2 = runAudit(parsed, 2);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r2.canonical.map(String)).toEqual(r1.canonical.map(String));
    expect(r2.inlierIds).toEqual(r1.inlierIds);
    expect(r2.outlierIds).toEqual(r1.outlierIds);
  });

  it('fails with NO_FRAME when all source points are collinear', () => {
    // 8 distinct collinear points on both sides: no four-point frame exists.
    const rows = Array.from({ length: 8 }, (_, i) =>
      row(`P${i}`, { x: i, y: 0 }, { x: i * 2, y: 0 }),
    );
    const res = runAudit(rows, 4);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('NO_FRAME');
  });

  it('fails with TOO_MANY_OUTLIERS when the ceiling cannot be met', () => {
    const sample = buildSample();
    const parsed = parseCorrespondences(sample.text).rows!;
    const res = runAudit(parsed, 1); // needs 2, ceiling 1
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('TOO_MANY_OUTLIERS');
    expect(res.bestOutlierCount).toBe(2);
  });

  it('accepts a clean batch with limit 0', () => {
    const clean: Correspondence[] = [
      [0, 0], [1, 0], [0, 1], [2, 3], [4, 2], [3, 5], [6, 1], [2, 6],
    ].map(([x, y], i) => row(`Q${i}`, { x, y }, { x, y }));
    const res = runAudit(clean, 0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.outlierCount).toBe(0);
    expect(res.canonical.map(String)).toEqual([
      '1', '0', '0', '0', '1', '0', '0', '0', '1',
    ]);
  });

  it('counts multiple distinct optimal transforms under a genuine tie', () => {
    // Four identity-consistent points and four translation-consistent points.
    // Each transform explains exactly one group (4 inliers); no transform can
    // cover both groups, so the optimum is tied between distinct matrices.
    const g1 = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const g2 = [[10, 10], [12, 10], [10, 12], [13, 13]];
    const rows: Correspondence[] = [
      ...g1.map(([x, y], i) => row(`I${i}`, { x, y }, { x, y })),
      ...g2.map(([x, y], i) => row(`T${i}`, { x, y }, { x: x + 100, y })),
    ];
    const res = runAudit(rows, 4);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.outlierCount).toBe(4);
    expect(res.inlierIds.length + res.outlierIds.length).toBe(8);
    expect(res.distinctOptimal).toBeGreaterThanOrEqual(2);
    // The reported canonical solution must be self-consistent: every retained
    // point maps exactly, no removed point does.
    const H: Homography = {
      m: res.canonical.map((v) => ({ n: v, d: 1n })) as Homography['m'],
    };
    for (const r of rows) {
      const exact = mapsExactly(H, { x: r.ax, y: r.ay }, { x: r.bx, y: r.by });
      expect(exact).toBe(res.inlierIds.includes(r.id));
    }
  });

  it('uses exact (not epsilon) judgment: a one-unit B-side error is an outlier', () => {
    const clean: Correspondence[] = [
      [0, 0], [4, 0], [0, 4], [2, 3], [5, 2], [3, 5], [6, 1], [1, 6],
    ].map(([x, y], i) => row(`R${i}`, { x, y }, { x, y }));
    clean[7].bx += 1; // one-unit mark error on R7
    const res = runAudit(clean, 1);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.outlierIds).toEqual(['R7']);
  });

  it('treats a correspondence whose image is at infinity (W = 0) as an outlier', () => {
    // Frame A = standard frame; B = (0,0),(3,0),(0,2),(4,2) induces the exact
    // integer matrix G = [[6,0,0],[0,6,0],[0,1,2]], i.e. W = y + 2; the line
    // y = -2 maps to infinity. Seven correspondences are exact under it; E with
    // source y = -2 lands on W = 0 and must be the sole outlier.
    const rows: Correspondence[] = [
      row('F1', { x: 0, y: 0 }, { x: 0, y: 0 }),
      row('F2', { x: 1, y: 0 }, { x: 3, y: 0 }),
      row('F3', { x: 0, y: 1 }, { x: 0, y: 2 }),
      row('F4', { x: 2, y: 1 }, { x: 4, y: 2 }),
      row('X1', { x: 1, y: -3 }, { x: -6, y: 18 }),
      row('X2', { x: 3, y: -3 }, { x: -18, y: 18 }),
      row('X3', { x: 5, y: -1 }, { x: 30, y: -6 }),
      row('E', { x: 5, y: -2 }, { x: 42, y: 42 }), // image has W = 0
    ];
    const res = runAudit(rows, 1);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.outlierCount).toBe(1);
    expect(res.outlierIds).toEqual(['E']);
  });

  it('reports W = 0 (zero-denominator) correspondences when the ceiling is exceeded', () => {
    // Same data as the test above (G = [[6,0,0],[0,6,0],[0,1,2]], seven exact
    // points, one E whose source lies on the line y = -2 mapped to infinity).
    // With ceiling 0 the audit must fail as TOO_MANY_OUTLIERS while reporting
    // that the single residual correspondence has a zero denominator.
    const rows: Correspondence[] = [
      row('F1', { x: 0, y: 0 }, { x: 0, y: 0 }),
      row('F2', { x: 1, y: 0 }, { x: 3, y: 0 }),
      row('F3', { x: 0, y: 1 }, { x: 0, y: 2 }),
      row('F4', { x: 2, y: 1 }, { x: 4, y: 2 }),
      row('X1', { x: 1, y: -3 }, { x: -6, y: 18 }),
      row('X2', { x: 3, y: -3 }, { x: -18, y: 18 }),
      row('X3', { x: 5, y: -1 }, { x: 30, y: -6 }),
      row('E', { x: 5, y: -2 }, { x: 42, y: 42 }), // image has W = 0
    ];
    const res = runAudit(rows, 0);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('TOO_MANY_OUTLIERS');
    expect(res.bestOutlierCount).toBe(1);
    expect(res.infinityCount).toBe(1);
    expect(res.message).toContain('W = 0');
  });
});
