/* eslint-disable @typescript-eslint/no-var-requires */
// Node invokes this CommonJS entrypoint directly, without a transpilation step.
const fs = require('fs');
const path = require('path');

const { summaryReportIcon } = require('./summary-status.cjs');

function inspectSummaryCompletion(runDirectory) {
  const result = { runDirectory, summaryFiles: [], errors: [] };
  if (typeof runDirectory !== 'string' || !runDirectory.trim()) {
    result.errors.push('An explicit run directory is required');
    return result;
  }
  try {
    result.summaryFiles = fs
      .readdirSync(runDirectory)
      .filter((name) => name.endsWith('.summary.json'))
      .sort();
  } catch (error) {
    result.errors.push(`Cannot read run directory: ${error.message}`);
    return result;
  }
  if (!result.summaryFiles.length) {
    result.errors.push('No journey summaries found in the run directory');
  }
  for (const name of result.summaryFiles) {
    try {
      const summary = JSON.parse(
        fs.readFileSync(path.join(runDirectory, name), 'utf8')
      );
      if (summaryReportIcon(summary) !== '✅') {
        result.errors.push(`${name}: journey did not complete successfully`);
      }
    } catch (error) {
      result.errors.push(`${name}: invalid summary: ${error.message}`);
    }
  }
  return result;
}

function assertSummaryCompletion(runDirectory) {
  const result = inspectSummaryCompletion(runDirectory);
  if (result.errors.length) {
    throw new Error(
      `Visual journey evidence failed:\n${result.errors.join('\n')}`
    );
  }
  return result;
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) {
      throw new Error(
        'Usage: node e2e/scripts/check-summary-completion.cjs <run-directory>'
      );
    }
    const result = assertSummaryCompletion(process.argv[2]);
    console.log(
      `Verified ${result.summaryFiles.length} completed journey summaries`
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { inspectSummaryCompletion, assertSummaryCompletion };
