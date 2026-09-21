import { describe, expect, it } from 'vitest';
import {
  canonicalIntegers,
  frameLift,
  homographyFromFrames,
  mapsExactly,
  applyHomography,
  type Point,
} from './homography';
import { ratToText } from './format';

const P = (x: number, y: number): Point => ({ x, y });

describe('frame lift non-degeneracy', () => {
  it('accepts four points with no three collinear', () => {
    expect(frameLift(P(0, 0), P(1, 0), P(0, 1), P(1, 1))).not.toBeNull();
  });

  it('rejects when the first three are collinear', () => {
    expect(frameLift(P(0, 0), P(1, 1), P(2, 2), P(3, 5))).toBeNull();
  });

  it('rejects when the fourth lies on a frame edge', () => {
    // (2,0) is on the line through (0,0)-(1,0)
    expect(frameLift(P(0, 0), P(1, 0), P(0, 1), P(2, 0))).toBeNull();
    // (2,2) lies on line (1,0)-(0,1): x+y=1? no, x+y=4... pick (2,-1): x+y=1
    expect(frameLift(P(0, 0), P(1, 0), P(0, 1), P(2, -1))).toBeNull();
  });

  it('rejects duplicate points', () => {
    expect(frameLift(P(0, 0), P(1, 0), P(0, 1), P(1, 0))).toBeNull();
  });
});

describe('homography from frames', () => {
  it('maps the four frame points exactly (standard frame)', () => {
    const a: [Point, Point, Point, Point] = [P(0, 0), P(1, 0), P(0, 1), P(1, 1)];
    const b: [Point, Point, Point, Point] = [P(2, 3), P(5, 3), P(2, 7), P(6, 9)];
    const H = homographyFromFrames(a, b)!;
    expect(H).not.toBeNull();
    for (let i = 0; i < 4; i++) expect(mapsExactly(H, a[i], b[i])).toBe(true);
  });

  it('recovers a general non-affine integer homography on many points', () => {
    // H: x' = (2x + 3y + 7) / (x - y + 5), y' = (x + 4y + 1)/(x - y + 5)
    const M = [2n, 3n, 7n, 1n, 4n, 1n, 1n, -1n, 5n];
    const src: Point[] = [];
    const dst: Point[] = [];
    outer: for (let x = -4; x <= 8; x++) {
      for (let y = -4; y <= 8; y++) {
        const X = BigInt(x);
        const Y = BigInt(y);
        const w = M[6] * X + M[7] * Y + M[8];
        if (w === 0n) continue;
        const u = M[0] * X + M[1] * Y + M[2];
        const v = M[3] * X + M[4] * Y + M[5];
        if (u % w !== 0n || v % w !== 0n) continue;
        const ux = Number(u / w);
        const uy = Number(v / w);
        if (dst.some((q) => q.x === ux && q.y === uy)) continue;
        src.push(P(x, y));
        dst.push(P(ux, uy));
        if (src.length >= 10) break outer;
      }
    }
    expect(src.length).toBeGreaterThanOrEqual(8);
    const H = homographyFromFrames([src[0], src[1], src[2], src[3]], [dst[0], dst[1], dst[2], dst[3]])!;
    expect(H).not.toBeNull();
    for (let i = 0; i < src.length; i++) {
      expect(mapsExactly(H, src[i], dst[i])).toBe(true);
    }
  });

  it('canonical form is scale-invariant and sign-normalized', () => {
    const a: [Point, Point, Point, Point] = [P(0, 0), P(4, 0), P(0, 4), P(2, 3)];
    const b: [Point, Point, Point, Point] = [P(1, 1), P(9, 2), P(2, 8), P(7, 7)];
    const H = homographyFromFrames(a, b)!;
    const c1 = canonicalIntegers(H);
    // Scaling every rational entry by -3/7 must give the same canonical vector.
    const scaled = {
      m: H.m.map((r) => ({ n: r.n * -3n, d: r.d * 7n })),
    } as typeof H;
    const c2 = canonicalIntegers(scaled);
    expect(c2).toEqual(c1);
    // first non-zero is positive
    expect(c1.find((v) => v !== 0n)! > 0n).toBe(true);
    // gcd of entries == 1
    const gcd = (u: bigint, v: bigint) => {
      let x = u < 0n ? -u : u;
      let y = v < 0n ? -v : v;
      while (y) [x, y] = [y, x % y];
      return x;
    };
    expect(c1.reduce(gcd)).toBe(1n);
  });

  it('reports a point mapping to infinity via zero denominator', () => {
    // Projectivity sending the line x=1 to infinity: w = 1 - x,
    // so (x, y) ~ (x/(1-x), y/(1-x)). Finite integer images require
    // 1-x in {+1,-1}, i.e. x = 0 or x = 2; the frame below respects that.
    const a: [Point, Point, Point, Point] = [P(0, 0), P(2, 0), P(0, 2), P(2, 4)];
    const b: [Point, Point, Point, Point] = [P(0, 0), P(-2, 0), P(0, 2), P(-2, -4)];
    const H = homographyFromFrames(a, b)!;
    // (1, 5) on the source side maps to infinity (denominator w = 0)
    expect(applyHomography(H, P(1, 5))).toBeNull();
    for (let i = 0; i < 4; i++) expect(mapsExactly(H, a[i], b[i])).toBe(true);
  });

  it('exact fractions in a nontrivial mapping', () => {
    // Standard frame on the A side (LA = I); B frame (0,0),(2,0),(0,2),(1,2)
    // induces a genuinely non-affine projectivity. Independent frame-lift
    // arithmetic gives canonical H = [[2,0,0],[0,4,0],[0,1,1]], hence
    // H(1,2) = (2,8,3) = (2/3, 8/3) exactly.
    const a: [Point, Point, Point, Point] = [P(0, 0), P(1, 0), P(0, 1), P(1, 1)];
    const b: [Point, Point, Point, Point] = [P(0, 0), P(2, 0), P(0, 2), P(1, 2)];
    const H = homographyFromFrames(a, b)!;
    expect(H).not.toBeNull();
    for (let i = 0; i < 4; i++) expect(mapsExactly(H, a[i], b[i])).toBe(true);
    const z = applyHomography(H, P(1, 2))!;
    expect(z).not.toBeNull();
    expect(ratToText(z.x)).toBe('2/3');
    expect(ratToText(z.y)).toBe('8/3');
  });
});
