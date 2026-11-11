'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { trustedRevision } = require('../agent-pr-revision.cjs');

const pull = () => ({ base: { repo: { id: 42 } }, head: { repo: { id: 42 }, sha: 'a'.repeat(40) } });

test('captures the same-repository immutable head', () => {
  const input = pull();
  const sha = trustedRevision(input, '42');
  input.head.sha = 'b'.repeat(40);
  assert.equal(sha, 'a'.repeat(40));
});

test('external, deleted, mismatched and malformed heads are refused', () => {
  for (const change of [
    input => { input.head.repo.id = 84; },
    input => { input.head.repo = null; },
    input => { input.base.repo.id = 84; },
    input => { input.head.repo.id = '42'; },
    input => { input.head.sha = 'main'; },
    input => { input.head.sha = 'a'.repeat(40) + '\nsha=main'; },
    input => { input.head.sha = null; },
  ]) {
    const input = pull(); change(input);
    assert.throws(() => trustedRevision(input, '42'), /Privileged QA/);
  }
  assert.throws(() => trustedRevision(pull(), '042'), /Privileged QA/);
  assert.throws(() => trustedRevision(null, '42'), /Privileged QA/);
});

test('workflow checks trusted code before PR checkout or execution and avoids a mutable head', () => {
  const workflow = readFileSync(new URL('../../workflows/agent-invoke.yml', 'file://' + __filename), 'utf8');
  const gate = workflow.indexOf('node .github/scripts/agent-pr-revision.cjs');
  const checkout = workflow.indexOf('name: Checkout trusted PR revision');
  assert(gate > 0 && checkout > gate && workflow.indexOf('run: yarn install') > checkout);
  assert.match(workflow.slice(checkout), /ref: \$\{\{ steps\.revision\.outputs\.sha \}\}/);
  assert(!workflow.includes('gh pr checkout'));
  assert.equal((workflow.match(/persist-credentials: false/g) || []).length, 2);
  const media = workflow.slice(workflow.indexOf('name: Publish media + build report'));
  const authentication = media.indexOf('gh auth setup-git');
  assert(authentication >= 0 && authentication < media.indexOf('node e2e/scripts/post-results.mjs'));
});
