import { useMemo } from 'react';
import type { Correspondence } from '../lib/audit';
import type { Homography, Point } from '../lib/homography';
import { applyHomography } from '../lib/homography';
import { ratToNumber } from '../lib/format';

interface Props {
  rows: Correspondence[];
  inlierIds: string[];
  H: Homography;
}

interface XY {
  x: number;
  y: number;
}

const PAD = 48;
const W = 760;
const HGT = 520;

export default function OverlaySvg({ rows, inlierIds, H }: Props) {
  const model = useMemo(() => {
    const inlier = new Set(inlierIds);
    const bPts: Record<string, XY> = {};
    const proj: Record<string, XY | null> = {};
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let offChart = 0;
    for (const r of rows) {
      const bp = { x: r.bx, y: r.by };
      bPts[r.id] = bp;
      minX = Math.min(minX, bp.x);
      minY = Math.min(minY, bp.y);
      maxX = Math.max(maxX, bp.x);
      maxY = Math.max(maxY, bp.y);
      const img = applyHomography(H, { x: r.ax, y: r.ay } as Point);
      if (!img) {
        proj[r.id] = null; // image lies on the line at infinity
        offChart++;
        continue;
      }
      const x = ratToNumber(img.x);
      const y = ratToNumber(img.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e12 || Math.abs(y) > 1e12) {
        proj[r.id] = null;
        offChart++;
      } else {
        proj[r.id] = { x, y };
      }
    }
    // The chart frames the second-side plate (the audit target). Widen for
    // nearby outlier projections; far ones are clipped at the boundary.
    if (minX === maxX) {
      minX -= 1;
      maxX += 1;
    }
    if (minY === maxY) {
      minY -= 1;
      maxY += 1;
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    minX -= spanX * 0.08;
    maxX += spanX * 0.08;
    minY -= spanY * 0.08;
    maxY += spanY * 0.08;

    const sx = (W - 2 * PAD) / (maxX - minX);
    const sy = (HGT - 2 * PAD) / (maxY - minY);
    const s = Math.min(sx, sy);
    const ox = PAD + ((W - 2 * PAD) - s * (maxX - minX)) / 2;
    const oy = PAD + ((HGT - 2 * PAD) - s * (maxY - minY)) / 2;
    // Screen Y is inverted relative to plate Y.
    const X = (p: XY) => ox + (p.x - minX) * s;
    const Y = (p: XY) => oy + (maxY - p.y) * s;

    return { X, Y, bPts, proj, inlier, offChart, minX, maxX, minY, maxY };
  }, [rows, inlierIds, H]);

  const { X, Y, bPts, proj, inlier, offChart } = model;

  return (
    <div className="svg-wrap">
      <svg viewBox={`0 0 ${W} ${HGT}`} role="img" aria-label="规范变换叠加证据图">
        <rect x={0} y={0} width={W} height={HGT} className="svg-bg" />
        {/* frame border = target plate extent */}
        <rect
          x={X({ x: model.minX, y: 0 })}
          y={Y({ x: 0, y: model.maxY })}
          width={(model.maxX - model.minX) * (X({ x: 1, y: 0 }) - X({ x: 0, y: 0 }))}
          height={(model.maxY - model.minY) * (Y({ x: 0, y: 0 }) - Y({ x: 0, y: 1 }))}
          className="svg-extent"
        />
        {rows.map((r) => {
          const bp = bPts[r.id];
          const pp = proj[r.id];
          const good = inlier.has(r.id);
          if (good) {
            const cx = X(bp);
            const cy = Y(bp);
            return (
              <g key={r.id} className="g-inlier">
                <circle cx={cx} cy={cy} r={6.5} className="mk-inlier" />
                <circle cx={cx} cy={cy} r={2} className="mk-inlier-core" />
                <text x={cx + 9} y={cy - 7} className="lbl lbl-inlier">{r.id}</text>
              </g>
            );
          }
          const bx = X(bp);
          const by = Y(bp);
          const px = pp ? X(pp) : null;
          const py = pp ? Y(pp) : null;
          return (
            <g key={r.id} className="g-outlier">
              {pp && (
                <line x1={px!} y1={py!} x2={bx} y2={by} className="ln-residual" />
              )}
              {pp && (
                <g transform={`translate(${px},${py})`}>
                  <path d="M -4 -4 L 4 4 M -4 4 L 4 -4" className="mk-proj" />
                  <text x={7} y={5} className="lbl lbl-proj">{r.id}′</text>
                </g>
              )}
              <rect x={bx - 5} y={by - 5} width={10} height={10} className="mk-outlier" />
              <text x={bx + 9} y={by - 7} className="lbl lbl-outlier">{r.id}</text>
            </g>
          );
        })}
      </svg>
      <ul className="legend">
        <li><span className="sw sw-inlier" /> 重合点：H(A) 与 B 精确相等（保留）</li>
        <li><span className="sw sw-proj" /> ×：A 经规范变换后的位置 H(A)</li>
        <li><span className="sw sw-outlier" /> □：B 侧实测点（剔除）</li>
        <li><span className="sw sw-line" /> 连线：离群残差 H(A)→B</li>
      </ul>
      {offChart > 0 && (
        <p className="offchart">注：有 {offChart} 个离群点的 H(A) 位于无穷远或视口极远处，未绘制投影标记。</p>
      )}
    </div>
  );
}
