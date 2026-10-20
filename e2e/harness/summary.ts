import fs from 'fs';
import path from 'path';

import { E2E_CONFIG } from './config';
import type { WorkerIdentityObservation } from './runtimeIdentity';

export type StepStatus = 'passed' | 'failed' | 'skipped';

export type StepRecord = {
  durationMs: number;
  name: string;
  note?: string;
  screenshot?: string;
  status: StepStatus;
};

export type Finding = {
  // Free-form QA observations agents should triage in follow-up loops.
  detail: string;
  severity: 'info' | 'quirk' | 'bug';
  step?: string;
};

export type RunSummary = {
  chainEvidence: {
    addresses: Record<string, string>;
    txHashes: string[];
  };
  endedAt?: string;
  env: {
    chainId: number;
    headless: boolean;
    rpcUrl: string;
    runId: string;
  };
  findings: Finding[];
  journey: string;
  startedAt: string;
  status: 'running' | 'passed' | 'failed';
  steps: StepRecord[];
  workerIdentity?: WorkerIdentityObservation;
};

// Per-journey JSON summary written under the run's artifacts directory.
// This file is the machine-readable contract for agent loops and CI bots:
// stable keys, screenshot paths relative to the artifacts dir, and explicit
// findings (bug/quirk/info) for follow-up triage.
export class JourneySummary {
  private summary: RunSummary;
  private file: string;

  constructor(journey: string) {
    fs.mkdirSync(E2E_CONFIG.artifactsDir, { recursive: true });
    this.file = path.join(
      E2E_CONFIG.artifactsDir,
      `${journey.replace(/[^a-z0-9-]/gi, '_')}.summary.json`
    );
    this.summary = {
      chainEvidence: { addresses: {}, txHashes: [] },
      env: {
        chainId: E2E_CONFIG.chainId,
        headless: E2E_CONFIG.headless,
        rpcUrl: E2E_CONFIG.rpcUrl,
        runId: E2E_CONFIG.runId,
      },
      findings: [],
      journey,
      startedAt: new Date().toISOString(),
      status: 'running',
      steps: [],
    };
    // A journey name owns one primary summary for this run. Never erase an
    // earlier case (including a different name with the same sanitized path).
    fs.writeFileSync(this.file, JSON.stringify(this.summary, null, 2), {
      flag: 'wx',
    });
  }

  addStep(step: StepRecord) {
    this.summary.steps.push(step);
    if (step.status === 'failed') {
      this.summary.status = 'failed';
    }
    this.flush();
  }

  addFinding(finding: Finding) {
    this.summary.findings.push(finding);
    this.flush();
  }

  addTxHash(hash: string) {
    if (!this.summary.chainEvidence.txHashes.includes(hash)) {
      this.summary.chainEvidence.txHashes.push(hash);
    }
    this.flush();
  }

  addAddress(name: string, address: string) {
    this.summary.chainEvidence.addresses[name] = address;
    this.flush();
  }

  setWorkerIdentity(value: WorkerIdentityObservation) {
    this.summary.workerIdentity = value;
    this.flush();
  }

  finish(status: 'passed' | 'failed' = 'failed') {
    // Passing requires explicit completion and must never erase a failed step.
    this.summary.status =
      status === 'passed' && this.summary.status !== 'failed'
        ? 'passed'
        : 'failed';
    this.summary.endedAt = new Date().toISOString();
    this.flush();
  }

  get filePath() {
    return this.file;
  }

  private flush() {
    fs.writeFileSync(this.file, JSON.stringify(this.summary, null, 2));
  }
}
