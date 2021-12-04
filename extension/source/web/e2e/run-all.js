const path = require('path');
const { promises: fs } = require('fs');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { runInShell } = require('./lib/run-command');
const { exitWithError } = require('./lib/exit-with-error');

async function main() {
  const { argv } = yargs(hideBin(process.argv))
    .usage(
      '$0 [options]',
      'Run all E2E tests, with a variable number of retries.',
      (_yargs) =>
        _yargs
          .option('browser', {
            description: `Set the browser used; either 'chrome' or 'firefox'.`,
            type: 'string',
            choices: ['chrome', 'firefox'],
          })
          .option('retries', {
            description:
              'Set how many times the test should be retried upon failure.',
            type: 'number',
          }),
    )
    .strict()
    .help('help');

  const { browser, retries } = argv;

  const testDir = path.join(__dirname, 'tests');

  const allE2eTestPath = path.join(__dirname, '/tests');
  const runE2eTestPath = path.join(__dirname, 'run-e2e-test.js');

  const args = [runE2eTestPath];
  if (browser) {
    args.push('--browser', browser);
  }
  if (retries) {
    args.push('--retries', retries);
  }

  await runInShell('node', [...args, allE2eTestPath]);

}

main().catch((error) => {
  exitWithError(error);
});
