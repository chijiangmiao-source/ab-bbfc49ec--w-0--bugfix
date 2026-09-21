import { expect, test, type Page } from '@playwright/test';

const SAMPLE_OUTLIERS = ['P04', 'P10'];
const EXPECTED_MATRIX = ['300', '100', '10000', '100', '400', '20000', '1', '2', '1000'];

async function runSampleAudit(page: Page, limit = '2') {
  await page.getByTestId('btn-sample').click();
  await expect(page.getByTestId('input-points')).not.toHaveValue('');
  await page.getByTestId('input-limit').fill(limit);
  await page.getByTestId('btn-run').click();
  await expect(page.getByTestId('notice-success')).toBeVisible();
}

test.describe('glass-plate homography audit', () => {
  test('sample batch: exact matrix, partition, counts and SVG overlay evidence', async ({ page }, testInfo) => {
    const origin = testInfo.project.use.baseURL as string;
    const external: string[] = [];
    page.on('request', (req) => {
      if (!req.url().startsWith(origin)) external.push(req.url());
    });

    await page.goto('/');
    await expect(page).toHaveTitle(/射影配准审计/);

    await runSampleAudit(page);

    // Counts and ceiling.
    await expect(page.getByTestId('inlier-count')).toHaveText('10');
    await expect(page.getByTestId('outlier-count')).toHaveText('2');
    await expect(page.getByTestId('distinct-count')).toHaveText('1');
    const frames = Number((await page.getByTestId('frames-count').textContent()) ?? '0');
    expect(frames).toBeGreaterThan(0);

    // Canonical nine-integer matrix, row-major (display uses thousands separators).
    for (let i = 0; i < 9; i++) {
      const cell = page.locator(`[data-testid=matrix] [data-pos="${Math.floor(i / 3)}${i % 3}"]`);
      expect((await cell.textContent())?.replace(/,/g, '')).toBe(EXPECTED_MATRIX[i]);
    }

    // Retained / removed identifiers.
    const inChips = await page.getByTestId('inlier-list').locator('.chip').allTextContents();
    const outChips = await page.getByTestId('outlier-list').locator('.chip').allTextContents();
    expect(inChips).toHaveLength(10);
    expect(outChips.sort()).toEqual([...SAMPLE_OUTLIERS]);
    expect(inChips).not.toContain(SAMPLE_OUTLIERS[0]);

    // SVG overlay: coincident points, outliers, residual lines, projections.
    await expect(page.locator('svg .mk-inlier')).toHaveCount(10);
    await expect(page.locator('svg .mk-outlier')).toHaveCount(2);
    await expect(page.locator('svg .ln-residual')).toHaveCount(2);
    await expect(page.locator('svg .mk-proj')).toHaveCount(2);

    // Per-point exact verification table.
    for (const id of inChips) {
      await expect(page.getByTestId(`verdict-${id}`)).toHaveText('保留·精确重合');
    }
    for (const id of SAMPLE_OUTLIERS) {
      await expect(page.getByTestId(`verdict-${id}`)).toHaveText('剔除·离群');
    }

    // The page must not contact any non-local origin (browser-only requirement).
    expect(external).toEqual([]);
  });

  test('ceiling exceeded: failure reason shown, input retained, old figure cleared', async ({ page }) => {
    await page.goto('/');
    await runSampleAudit(page);
    await expect(page.getByTestId('result-panel')).toBeVisible();

    // Tighten the ceiling below the true minimum of 2.
    await page.getByTestId('input-limit').fill('0');
    const typed = await page.getByTestId('input-points').inputValue();
    await page.getByTestId('btn-run').click();

    const failure = page.getByTestId('notice-failure');
    await expect(failure).toBeVisible();
    await expect(failure).toContainText(/离群/);
    await expect(page.getByTestId('result-panel')).toHaveCount(0);
    // Input preserved verbatim.
    await expect(page.getByTestId('input-points')).toHaveValue(typed);

    // Re-running with the correct ceiling restores the successful figure.
    await page.getByTestId('input-limit').fill('2');
    await page.getByTestId('btn-run').click();
    await expect(page.getByTestId('result-panel')).toBeVisible();
    await expect(page.getByTestId('outlier-count')).toHaveText('2');
  });

  test('zero denominator: W = 0 correspondence fails the audit even within the outlier ceiling', async ({ page }) => {
    await page.goto('/');
    // A successful figure first, so the regression also proves it is cleared.
    await runSampleAudit(page);
    await expect(page.getByTestId('result-panel')).toBeVisible();

    // Seven points exact under G = [[6,0,0],[0,6,0],[0,1,2]] (W = y + 2);
    // E has source y = -2, so its homogeneous denominator is exactly zero.
    // Ceiling 1 could absorb E as the sole outlier, but a zero denominator
    // must fail the audit instead of becoming a success.
    const data = [
      'F1, 0, 0, 0, 0',
      'F2, 1, 0, 3, 0',
      'F3, 0, 1, 0, 2',
      'F4, 2, 1, 4, 2',
      'X1, 1, -3, -6, 18',
      'X2, 3, -3, -18, 18',
      'X3, 5, -1, 30, -6',
      'E, 5, -2, 42, 42',
    ].join('\n');
    await page.getByTestId('input-points').fill(data);
    await page.getByTestId('input-limit').fill('1');
    await page.getByTestId('btn-run').click();

    // Failure explained by the zero denominator; no success artifacts remain.
    const failure = page.getByTestId('notice-failure');
    await expect(failure).toBeVisible();
    await expect(failure).toContainText('分母为零');
    await expect(failure).toContainText('W = 0');
    await expect(page.getByTestId('notice-success')).toHaveCount(0);
    await expect(page.getByTestId('result-panel')).toHaveCount(0);
    await expect(page.locator('svg')).toHaveCount(0);
    await expect(page.getByText('无穷远点（w = 0）', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('verdict-E')).toHaveCount(0);
    // Input preserved verbatim.
    await expect(page.getByTestId('input-points')).toHaveValue(data);
  });

  test('no four-point frame: failure with retained input and cleared figure', async ({ page }) => {
    await page.goto('/');
    await runSampleAudit(page);
    await expect(page.locator('svg .mk-inlier')).toHaveCount(10);

    // Eight distinct points all collinear on side A: no projective frame exists.
    const collinear = Array.from({ length: 8 }, (_, i) => `P${i}, ${i}, 0, ${i + 3}, ${i * i + 1}`).join('\n');
    await page.getByTestId('input-points').fill(collinear);
    await page.getByTestId('input-limit').fill('4');
    await page.getByTestId('btn-run').click();

    await expect(page.getByTestId('notice-failure')).toContainText(/标架/);
    await expect(page.getByTestId('result-panel')).toHaveCount(0);
    await expect(page.locator('svg')).toHaveCount(0);
    await expect(page.getByTestId('input-points')).toHaveValue(collinear);
  });

  test('malformed input is rejected and never produces a figure', async ({ page }) => {
    await page.goto('/');
    const bad = [
      'P0, 0, 0, 1, 1',
      'P0, 1, 0, 2, 1', // duplicate identifier
      'P1, 0, 1, 1, 2',
      'P2, 2, 2, 3, 3',
      'P3, 3, 4, 4, 5',
      'P4, 4, 5, 5, 6',
      'P5, 5, 6, 6, 7',
      'P6, 6, 7, 7, 8',
    ].join('\n');
    await page.getByTestId('input-points').fill(bad);
    await page.getByTestId('btn-run').click();
    await expect(page.getByTestId('notice-error')).toContainText(/标识重复/);
    await expect(page.getByTestId('result-panel')).toHaveCount(0);
  });

  test('editing a point and re-auditing updates the exact verdict live', async ({ page }) => {
    await page.goto('/');
    await runSampleAudit(page);
    await expect(page.getByTestId('verdict-P01')).toHaveText('保留·精确重合');

    // Corrupt P01's B-side mark by one unit via the editor; minimum outliers
    // becomes 3 which exceeds ceiling 2.
    const text = await page.getByTestId('input-points').inputValue();
    const edited = text.replace(/^P01,(\s*-?\d+),(\s*-?\d+),(\s*-?\d+),/m, 'P01,$1,$2,999,');
    expect(edited).not.toBe(text);
    await page.getByTestId('input-points').fill(edited);
    await page.getByTestId('btn-run').click();
    await expect(page.getByTestId('notice-failure')).toBeVisible();
  });
});
