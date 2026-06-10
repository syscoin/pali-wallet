#!/usr/bin/env node
// Publishes e2e run proof to GitHub:
//   1. Copies screenshots, videos and summary JSONs from e2e/artifacts/ onto
//      an orphan media branch (default: e2e-media) and pushes it, so images
//      can be embedded inline in issue/PR comments via raw.githubusercontent.
//   2. Builds a markdown report (agent report + per-journey step tables,
//      findings, inline screenshots, video links) and writes it to the path
//      given as argv[2] for the workflow to post with `gh`.
//
// Usage: node e2e/scripts/post-results.mjs <output-markdown-path>
// Env:   GITHUB_REPOSITORY (owner/repo), MEDIA_BRANCH (default e2e-media),
//        GITHUB_RUN_ID (optional, used in media paths)

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const artifactsRoot = path.join(repoRoot, 'e2e', 'artifacts');
const outPath = process.argv[2];
const repoSlug = process.env.GITHUB_REPOSITORY;
const mediaBranch = process.env.MEDIA_BRANCH || 'e2e-media';
const ciRunId = process.env.GITHUB_RUN_ID || 'local';

if (!outPath) {
  console.error('usage: post-results.mjs <output-markdown-path>');
  process.exit(1);
}

const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', ...opts });

const listRunDirs = () => {
  if (!fs.existsSync(artifactsRoot)) return [];
  return fs
    .readdirSync(artifactsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
};

const collectMedia = (runId) => {
  const runDir = path.join(artifactsRoot, runId);
  const files = [];
  const shotsDir = path.join(runDir, 'screenshots');
  if (fs.existsSync(shotsDir)) {
    for (const file of fs.readdirSync(shotsDir).sort()) {
      files.push({
        rel: `screenshots/${file}`,
        src: path.join(shotsDir, file),
      });
    }
  }
  // The extension launcher records context videos to <runDir>/videos/
  // (see harness/launch.ts recordVideo.dir).
  const videosDir = path.join(runDir, 'videos');
  if (fs.existsSync(videosDir)) {
    for (const file of fs.readdirSync(videosDir).sort()) {
      if (file.endsWith('.webm')) {
        files.push({
          rel: `videos/${file}`,
          src: path.join(videosDir, file),
        });
      }
    }
  }
  for (const file of fs.readdirSync(runDir)) {
    if (file.endsWith('.summary.json')) {
      files.push({ rel: file, src: path.join(runDir, file) });
    }
  }
  return files;
};

// --- 1. Push media to the orphan media branch ------------------------------

const runIds = listRunDirs();
const mediaPrefix = `runs/${ciRunId}`;
let mediaPushed = false;

if (repoSlug && runIds.length > 0) {
  const worktree = fs.mkdtempSync('/tmp/pali-e2e-media-');
  try {
    git(['fetch', 'origin', mediaBranch], { stdio: 'pipe' });
    git(['worktree', 'add', worktree, `origin/${mediaBranch}`]);
    git(['checkout', '-B', mediaBranch], { cwd: worktree });
  } catch {
    // Branch doesn't exist yet: create an orphan in the worktree.
    git(['worktree', 'add', '--detach', worktree]);
    git(['checkout', '--orphan', mediaBranch], { cwd: worktree });
    git(['rm', '-rf', '--quiet', '.'], { cwd: worktree });
  }

  for (const runId of runIds) {
    for (const file of collectMedia(runId)) {
      const dest = path.join(worktree, mediaPrefix, runId, file.rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(file.src, dest);
    }
  }

  try {
    git(['add', '-A'], { cwd: worktree });
    git(
      [
        '-c',
        'user.name=github-actions[bot]',
        '-c',
        'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit',
        '-m',
        `e2e media for CI run ${ciRunId}`,
      ],
      { cwd: worktree }
    );
    git(['push', 'origin', mediaBranch], { cwd: worktree });
    mediaPushed = true;
  } catch (error) {
    console.error(`media push skipped: ${error.message}`);
  } finally {
    git(['worktree', 'remove', '--force', worktree]);
  }
}

const mediaUrl = (runId, rel) =>
  `https://raw.githubusercontent.com/${repoSlug}/${mediaBranch}/${mediaPrefix}/${runId}/${rel}`;

// --- 2. Build the markdown report ------------------------------------------

const lines = [];

const agentReport = path.join(artifactsRoot, 'agent-report.md');
if (fs.existsSync(agentReport)) {
  lines.push(fs.readFileSync(agentReport, 'utf8').trim(), '');
}

for (const runId of runIds) {
  const runDir = path.join(artifactsRoot, runId);
  const summaries = fs
    .readdirSync(runDir)
    .filter((file) => file.endsWith('.summary.json'));

  for (const summaryFile of summaries) {
    const summary = JSON.parse(
      fs.readFileSync(path.join(runDir, summaryFile), 'utf8')
    );
    const icon = summary.status === 'passed' ? '✅' : '❌';
    lines.push(`## ${icon} Journey \`${summary.journey}\` (${runId})`, '');
    lines.push('| Step | Status | Duration |');
    lines.push('| --- | --- | --- |');
    for (const step of summary.steps || []) {
      const status = step.status === 'passed' ? '✅ passed' : '❌ failed';
      lines.push(
        `| ${step.name} | ${status} | ${Math.round(
          (step.durationMs || 0) / 1000
        )}s |`
      );
    }
    lines.push('');

    const findings = summary.findings || [];
    if (findings.length > 0) {
      lines.push('**Findings**');
      for (const finding of findings) {
        lines.push(`- \`${finding.severity}\` ${finding.detail}`);
      }
      lines.push('');
    }

    const addresses = summary.chainEvidence?.addresses || {};
    const txHashes = summary.chainEvidence?.txHashes || [];
    if (Object.keys(addresses).length > 0 || txHashes.length > 0) {
      lines.push('**On-chain evidence**');
      for (const [name, address] of Object.entries(addresses)) {
        lines.push(`- ${name}: \`${address}\``);
      }
      for (const hash of txHashes) {
        lines.push(`- tx: \`${hash}\``);
      }
      lines.push('');
    }

    if (mediaPushed) {
      lines.push('<details><summary>Screenshots (proof)</summary>', '');
      const shotsDir = path.join(runDir, 'screenshots');
      if (fs.existsSync(shotsDir)) {
        for (const shot of fs.readdirSync(shotsDir).sort()) {
          lines.push(`**${shot}**`, '');
          lines.push(`![${shot}](${mediaUrl(runId, `screenshots/${shot}`)})`, '');
        }
      }
      lines.push('</details>', '');

      const videos = collectMedia(runId).filter((file) =>
        file.rel.endsWith('.webm')
      );
      if (videos.length > 0) {
        lines.push('**Videos**');
        for (const video of videos) {
          lines.push(`- [${video.rel}](${mediaUrl(runId, video.rel)})`);
        }
        lines.push('');
      }
    }
  }
}

if (lines.length === 0) {
  lines.push(
    'No e2e artifacts were produced by this run. Check the workflow logs.'
  );
}

lines.push(
  '',
  `---`,
  `_Full artifacts (traces, html report) are attached to the workflow run._`
);

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'));
console.log(`report written to ${outPath} (mediaPushed=${mediaPushed})`);
