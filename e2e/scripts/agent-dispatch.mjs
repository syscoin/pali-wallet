#!/usr/bin/env node
// Runs a Cursor agent against this checkout to serve a GitHub-invoked QA
// request: create or run e2e journeys, triage the results, and leave a
// markdown report for the workflow to post back to the issue/PR.
//
// Inputs (env):
//   CURSOR_API_KEY  - required, Cursor user/service-account API key
//   AGENT_PROMPT    - required, the request text from the issue/PR comment
//   AGENT_MODEL     - optional, defaults to composer-2.5
//
// Output:
//   e2e/artifacts/agent-report.md  - final agent report (posted as comment)
//   exit 0 = finished, 1 = agent never started, 2 = agent run failed

import { Agent, CursorAgentError } from '@cursor/sdk';
import fs from 'fs';
import path from 'path';

const apiKey = process.env.CURSOR_API_KEY;
const userPrompt = (process.env.AGENT_PROMPT || '').trim();

if (!apiKey) {
  console.error('CURSOR_API_KEY is not set');
  process.exit(1);
}
if (!userPrompt) {
  console.error('AGENT_PROMPT is empty');
  process.exit(1);
}

const repoRoot = path.resolve(import.meta.dirname, '../..');
const reportPath = path.join(repoRoot, 'e2e', 'artifacts', 'agent-report.md');

const task = [
  'You are the Pali wallet e2e QA agent, invoked from a GitHub issue/PR.',
  '',
  'Ground rules:',
  '- First read e2e/AGENTS.md; it documents the harness, config, artifacts and known quirks.',
  '- The extension is already built at build/chrome and Playwright Chromium is installed.',
  '- You may create or modify journeys under e2e/journeys and harness code under e2e/harness.',
  '- Run journeys with: yarn e2e:harness [journeys/<name>]. Testnet steps are slow; be patient.',
  '- Triage results from e2e/artifacts/<runId>/<journey>.summary.json (steps, findings, chainEvidence).',
  '- If the request requires changing wallet source code, make the change minimally and rerun the relevant journey to prove it.',
  '- Do NOT run git commit/push/pr; the workflow handles publishing your changes.',
  '',
  `When done, write a concise markdown report to ${path.relative(repoRoot, reportPath)} containing:`,
  '- What you did and why',
  '- Journey results (pass/fail per step)',
  '- Findings (quirks/bugs) with severity',
  '- Which screenshots/videos under e2e/artifacts/<runId>/ prove the result (relative paths)',
  '',
  'The request from the authorized GitHub user:',
  '---',
  userPrompt,
].join('\n');

try {
  const result = await Agent.prompt(task, {
    apiKey,
    model: { id: process.env.AGENT_MODEL || 'composer-2.5' },
    local: { cwd: repoRoot },
  });

  console.log(`agent finished with status: ${result.status}`);

  if (!fs.existsSync(reportPath)) {
    // Fall back to the agent's final message so the comment is never empty.
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      result.result || 'Agent finished but produced no report.'
    );
  }

  if (result.status === 'error') {
    console.error(`agent run failed: ${result.id}`);
    process.exit(2);
  }
} catch (error) {
  if (error instanceof CursorAgentError) {
    console.error(
      `agent startup failed: ${error.message} (retryable=${error.isRetryable})`
    );
    process.exit(1);
  }
  throw error;
}
