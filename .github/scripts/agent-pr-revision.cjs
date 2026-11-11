'use strict';

/** Only repository-controlled code can enter this credential-bearing QA job. */
function trustedRevision(pull, repositoryId) {
  if (!/^[1-9][0-9]*$/.test(repositoryId) ||
      !Number.isSafeInteger(pull?.base?.repo?.id) ||
      !Number.isSafeInteger(pull?.head?.repo?.id) ||
      String(pull.base.repo.id) !== repositoryId ||
      String(pull.head.repo.id) !== repositoryId ||
      typeof pull.head.sha !== 'string' || !/^[0-9a-f]{40}$/.test(pull.head.sha)) {
    throw new Error('Privileged QA requires an immutable head from this repository; external PRs must use secretless CI.');
  }
  return pull.head.sha;
}

module.exports = { trustedRevision };

if (require.main === module) {
  try {
    const pull = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
    process.stdout.write(trustedRevision(pull, process.argv[2]) + '\n');
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
