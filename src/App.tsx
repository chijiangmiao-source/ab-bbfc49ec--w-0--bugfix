import { useState } from 'react';
import OverlaySvg from './components/OverlaySvg';
import {
  Correspondence,
  parseCorrespondences,
  parseOutlierLimit,
  runAudit,
  AuditSuccess,
} from './lib/audit';
import { applyHomography } from './lib/homography';
import { buildSample } from './lib/sample';
import { bigToText, ratToText } from './lib/format';

type View =
  | { kind: 'idle' }
  | { kind: 'input-error'; message: string }
  | { kind: 'failed'; reason: 'NO_FRAME' | 'TOO_MANY_OUTLIERS'; message: string; bestOutlierCount: number }
  | { kind: 'success'; result: AuditSuccess; rows: Correspondence[]; limit: number };

export default function App() {
  const [text, setText] = useState('');
  const [limitText, setLimitText] = useState('2');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>({ kind: 'idle' });

  const run = () => {
    const parsed = parseCorrespondences(text);
    if (!parsed.ok || !parsed.rows) {
      setView({ kind: 'input-error', message: parsed.error!.message });
      return;
    }
    const limit = parseOutlierLimit(limitText);
    if (limit === null) {
      setView({ kind: 'input-error', message: '离群上限必须是 0 至 4 的整数。' });
      return;
    }
    // Defer the (up to ~tens of milliseconds, BigInt-heavy) enumeration one
    // task so the busy state paints first instead of freezing the button.
    setBusy(true);
    const rows = parsed.rows;
    setTimeout(() => {
      const result = runAudit(rows, limit);
      if (!result.ok) {
        // Input text is deliberately left untouched; any previous figure is
        // replaced by this failure notice.
        setView({
          kind: 'failed',
          reason: result.reason,
          message: result.message,
          bestOutlierCount: result.bestOutlierCount,
        });
      } else {
        setView({ kind: 'success', result, rows, limit });
      }
      setBusy(false);
    }, 30);
  };

  const loadSample = () => {
    const s = buildSample();
    setText(s.text);
    setLimitText(s.limit);
    setView({ kind: 'idle' });
  };

  const clearAll = () => {
    setText('');
    setView({ kind: 'idle' });
  };

  return (
    <div className="page">
      <header>
        <h1>玻璃底片射影配准审计</h1>
        <p className="sub">
          全部计算在本浏览器内以 BigInt 有理数完成，不使用浮点、不访问网络、无业务后端。
          审计枚举所有非退化四点射影标架生成射影变换，精确判定每一对应；先最小化离群数，
          再按规范化九整数矩阵系数的字典序选取唯一规范解，并统计并列的不同最优变换数。
        </p>
      </header>

      <section className="panel" aria-label="对应点输入">
        <div className="panel-head">
          <h2>对应点</h2>
          <div className="actions">
            <button type="button" onClick={loadSample} data-testid="btn-sample">载入示例批次</button>
            <button type="button" onClick={clearAll} data-testid="btn-clear">清空</button>
          </div>
        </div>
        <p className="hint">
          每行一个点：<code>标识, X₁, Y₁, X₂, Y₂</code>（可用逗号、制表符或空格分隔；<code>#</code> 起始为注释）。
          每批 8–40 个唯一标识点；两侧坐标均为 |值| ≤ 1,000,000 的整数，同侧坐标不得重复。
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={12}
          placeholder="P01, 102, 44, 8, 12
P02, 218, 47, 39, 11
..."
          data-testid="input-points"
        />
        <div className="limit-row">
          <label htmlFor="limit">离群上限（0–4）</label>
          <input
            id="limit"
            value={limitText}
            onChange={(e) => setLimitText(e.target.value)}
            size={4}
            data-testid="input-limit"
          />
          <button type="button" className="primary" onClick={run} disabled={busy} data-testid="btn-run">
            {busy ? '审计中…' : '启动审计'}
          </button>
        </div>

        {view.kind === 'input-error' && (
          <div className="notice error" data-testid="notice-error" role="alert">
            <strong>输入无法审计：</strong> {view.message}
          </div>
        )}
        {view.kind === 'failed' && (
          <div className="notice failure" data-testid="notice-failure" role="alert">
            <strong>
              审计失败：{view.reason === 'NO_FRAME' ? '四点标架缺失' : '离群数超限'}
            </strong>{' '}
            {view.message}
            {view.reason === 'TOO_MANY_OUTLIERS' && view.bestOutlierCount < 100 && (
              <> 任何候选标架下的最少离群数为 {view.bestOutlierCount}。</>
            )}
            <div className="fail-sub">原输入已保留，旧图已清除。请核对或增补基准点后重新启动审计。</div>
          </div>
        )}
      </section>

      {view.kind === 'success' && <SuccessView view={view} />}

      <footer>
        纯静态页面 · 可离线运行 · 判定可复算：相同输入永远得到相同的规范化矩阵与离群划分。
      </footer>
    </div>
  );
}

function MatrixGrid({ values }: { values: bigint[] }) {
  return (
    <div className="matrix" data-testid="matrix">
      {[0, 1, 2].map((r) => (
        <div className="matrix-row" key={r}>
          {[0, 1, 2].map((c) => (
            <span className="matrix-cell" key={c} data-pos={`${r}${c}`}>
              {bigToText(values[r * 3 + c])}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function SuccessView({ view }: { view: Extract<View, { kind: 'success' }> }) {
  const { result, rows, limit } = view;
  const inSet = new Set(result.inlierIds);

  return (
    <section className="panel" aria-label="审计结果" data-testid="result-panel">
      <div className="notice ok" data-testid="notice-success">
        审计成功：保留 <strong data-testid="inlier-count">{result.inlierIds.length}</strong> 点，
        剔除 <strong data-testid="outlier-count">{result.outlierIds.length}</strong> 点
        （上限 {limit}）。
      </div>

      <div className="result-grid">
        <div>
          <h2>规范射影变换矩阵</h2>
          <p className="hint">九整数规范形（公分母通分、整体约去最大公因数、首非零系数取正）：</p>
          <MatrixGrid values={result.canonical} />
          <dl className="stats">
            <dt>枚举并检验的四点标架数</dt>
            <dd data-testid="frames-count">{result.framesEvaluated}</dd>
            <dt>并列最优（最少离群）的不同变换数</dt>
            <dd data-testid="distinct-count">{result.distinctOptimal}</dd>
            <dt>最少离群数</dt>
            <dd>{result.outlierCount}</dd>
          </dl>
        </div>
        <div>
          <h2>点的划分</h2>
          <div className="chips">
            <div>
              <h3>保留（{result.inlierIds.length}）</h3>
              <div className="chip-box" data-testid="inlier-list">
                {result.inlierIds.map((id) => (
                  <span className="chip chip-in" key={id}>{id}</span>
                ))}
              </div>
            </div>
            <div>
              <h3>剔除（{result.outlierIds.length}）</h3>
              <div className="chip-box" data-testid="outlier-list">
                {result.outlierIds.length === 0 && <span className="muted">无</span>}
                {result.outlierIds.map((id) => (
                  <span className="chip chip-out" key={id}>{id}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <h2>叠加证据</h2>
      <OverlaySvg rows={rows} inlierIds={result.inlierIds} H={result.homography} />

      <h2>逐点核对表（精确值）</h2>
      <div className="table-wrap">
        <table data-testid="verify-table">
          <thead>
            <tr>
              <th>标识</th>
              <th>A 侧 (X₁, Y₁)</th>
              <th>B 侧实测 (X₂, Y₂)</th>
              <th>H(A) 精确坐标</th>
              <th>判定</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const img = applyHomography(result.homography, { x: r.ax, y: r.ay });
              const good = inSet.has(r.id);
              return (
                <tr key={r.id} className={good ? 'row-in' : 'row-out'}>
                  <td>{r.id}</td>
                  <td>({r.ax}, {r.ay})</td>
                  <td>({r.bx}, {r.by})</td>
                  <td className="mono">
                    {img ? `(${ratToText(img.x)}, ${ratToText(img.y)})` : '无穷远点（w = 0）'}
                  </td>
                  <td data-testid={`verdict-${r.id}`}>{good ? '保留·精确重合' : '剔除·离群'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
