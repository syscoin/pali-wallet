import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  assertSummaryCompletion,
  inspectSummaryCompletion,
} from '../../e2e/scripts/check-summary-completion.cjs';

const script = path.resolve(
  __dirname,
  '../../e2e/scripts/check-summary-completion.cjs'
);
const passed = {
  status: 'passed',
  endedAt: '2026-10-20T01:02:03.000Z',
  steps: [{ name: 'assertions', status: 'passed' }],
};

describe('visual summary evidence gate', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pali-summary-evidence-')
    );
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const write = (name: string, summary: unknown) =>
    fs.writeFileSync(path.join(directory, name), JSON.stringify(summary));

  it('accepts completed standalone and stepped summaries without rewriting evidence', () => {
    write('stepped.summary.json', passed);
    write('standalone.summary.json', { ...passed, steps: [] });
    const files = fs.readdirSync(directory);
    const before = files.map((name) => ({
      contents: fs.readFileSync(path.join(directory, name), 'utf8'),
      modified: fs.statSync(path.join(directory, name)).mtimeMs,
    }));
    expect(assertSummaryCompletion(directory)).toEqual({
      runDirectory: directory,
      summaryFiles: ['standalone.summary.json', 'stepped.summary.json'],
      errors: [],
    });
    expect(fs.readdirSync(directory)).toEqual(files);
    expect(
      files.map((name) => ({
        contents: fs.readFileSync(path.join(directory, name), 'utf8'),
        modified: fs.statSync(path.join(directory, name)).mtimeMs,
      }))
    ).toEqual(before);
  });

  it.each([undefined, '', ' '])(
    'requires an explicit directory: %p',
    (input) => {
      expect(() => assertSummaryCompletion(input)).toThrow(
        'explicit run directory'
      );
    }
  );

  it('rejects a missing directory and a file used as the directory', () => {
    expect(() =>
      assertSummaryCompletion(path.join(directory, 'missing'))
    ).toThrow('Cannot read run directory');
    write('file.json', passed);
    expect(() =>
      assertSummaryCompletion(path.join(directory, 'file.json'))
    ).toThrow('Cannot read run directory');
  });

  it('rejects empty directories and does not borrow nested or unrelated evidence', () => {
    expect(() => assertSummaryCompletion(directory)).toThrow(
      'No journey summaries'
    );
    write('playwright.json', passed);
    fs.mkdirSync(path.join(directory, 'another-run'));
    fs.writeFileSync(
      path.join(directory, 'another-run', 'good.summary.json'),
      JSON.stringify(passed)
    );
    expect(() => assertSummaryCompletion(directory)).toThrow(
      'No journey summaries'
    );
  });

  it.each(['running', 'failed', 'skipped', undefined])(
    'rejects non-passed terminal status %p',
    (status) => {
      write('journey.summary.json', { ...passed, status });
      expect(() => assertSummaryCompletion(directory)).toThrow(
        'journey.summary.json: journey did not complete successfully'
      );
    }
  );

  it.each([undefined, null, '', 'invalid date', 1])(
    'rejects missing or invalid completion time %p',
    (endedAt) => {
      write('journey.summary.json', { ...passed, endedAt });
      expect(() => assertSummaryCompletion(directory)).toThrow(
        'did not complete successfully'
      );
    }
  );

  it('rejects a failed step even with a passed top-level status', () => {
    write('journey.summary.json', {
      ...passed,
      steps: [{ status: 'passed' }, { status: 'failed' }],
    });
    expect(() => assertSummaryCompletion(directory)).toThrow(
      'did not complete successfully'
    );
  });

  it.each([null, [], { ...passed, steps: {} }, { ...passed, steps: [null] }])(
    'fails closed for an invalid summary shape %p',
    (summary) => {
      write('journey.summary.json', summary);
      expect(() => assertSummaryCompletion(directory)).toThrow(
        'journey.summary.json'
      );
    }
  );

  it('reports every invalid file without allowing a healthy summary to hide it', () => {
    write('healthy.summary.json', passed);
    fs.writeFileSync(path.join(directory, 'broken.summary.json'), '{');
    fs.mkdirSync(path.join(directory, 'unreadable.summary.json'));
    write('unfinished.summary.json', { status: 'running' });
    const report = inspectSummaryCompletion(directory);
    expect(report.summaryFiles).toHaveLength(4);
    expect(report.errors).toHaveLength(3);
    expect(report.errors[0]).toContain('broken.summary.json: invalid summary');
    expect(report.errors[1]).toContain('unfinished.summary.json');
    expect(report.errors[2]).toContain(
      'unreadable.summary.json: invalid summary'
    );
    expect(() => assertSummaryCompletion(directory)).toThrow(
      'Visual journey evidence failed'
    );
  });

  it('preserves the existing summary policy for optional step lists', () => {
    write('legacy.summary.json', {
      status: passed.status,
      endedAt: passed.endedAt,
    });
    expect(assertSummaryCompletion(directory).errors).toEqual([]);
  });

  it('runs as an explicit-directory CLI and propagates evidence failure', () => {
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [script, ...args], {
        encoding: 'utf8',
      });
    expect(run().status).toBe(1);
    expect(run(directory, directory).status).toBe(1);
    const empty = run(directory);
    expect(empty.status).toBe(1);
    expect(empty.stderr).toContain('No journey summaries');
    write('journey.summary.json', passed);
    const healthy = run(directory);
    expect(healthy.status).toBe(0);
    expect(healthy.stdout).toContain('Verified 1 completed journey summaries');
    write('journey.summary.json', { ...passed, status: 'running' });
    const unfinished = run(directory);
    expect(unfinished.status).toBe(1);
    expect(unfinished.stderr).toContain('did not complete successfully');
  });
});

it('gates the exact visual shard directory after successful baselines and always uploads evidence', () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, '../../.github/workflows/main.yml'),
    'utf8'
  );
  const visual = workflow
    .split('\n  visual:\n')[1]
    .split('\n  visual-result:')[0];
  const steps = visual.split(/\n(?=      - )/);
  const baselineIndex = steps.findIndex((step) =>
    step.startsWith('      - name: Run visual baselines\n')
  );
  const gate = steps[baselineIndex + 1];
  const upload = steps[baselineIndex + 2];
  expect(baselineIndex).toBeGreaterThanOrEqual(0);
  expect(gate).toBe(
    '      - name: Require completed visual journey summaries\n' +
      '        run: node e2e/scripts/check-summary-completion.cjs "e2e/artifacts/pr-visual-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.shard }}"'
  );
  expect(steps[baselineIndex]).not.toContain('continue-on-error:');
  expect(steps[baselineIndex]).toContain(
    'PALI_E2E_RUN_ID: pr-visual-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.shard }}'
  );
  expect(upload).toContain(
    'name: Upload visual artifacts (diffs + new baselines)'
  );
  expect(upload).toContain('        if: always()');
});

it('runs four isolated visual shards and fails the aggregate unless every shard succeeds', () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, '../../.github/workflows/main.yml'),
    'utf8'
  );
  const visual = workflow
    .split('\n  visual:\n')[1]
    .split('\n  visual-result:')[0];
  const aggregate = workflow
    .split('\n  visual-result:\n')[1]
    .split('\n  conformance:')[0];

  expect(visual).toContain(
    '    name: visual regression shard ${{ matrix.shard }}/4'
  );
  expect(visual).toContain('        shard: [1, 2, 3, 4]');
  expect(visual).toContain('    timeout-minutes: 35');
  expect(visual).toContain('      fail-fast: false');
  expect(visual).toContain(
    '        run: yarn e2e:visual --update-snapshots=missing --shard=${{ matrix.shard }}/4 --workers=1'
  );
  expect(visual).not.toContain('continue-on-error:');
  expect(aggregate).toContain('    name: visual regression suite');
  expect(aggregate).toContain('    if: always()');
  expect(aggregate).toContain('    needs: visual');
  expect(aggregate).toContain(
    "        run: test '${{ needs.visual.result }}' = 'success'"
  );
  expect(aggregate).not.toContain('continue-on-error:');
});
