export const PRIVACY_PROVER_PORT_PREFIX = 'pali-privacy-prover-v1:';
export const isPrivacyProofJobId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value
  );

export interface IPrivacyProofInput {
  fee: string;
  nullifier: string;
  nullifierHash: string;
  pathElements: string[];
  pathIndices: number[];
  recipient: string;
  refund: string;
  relayer: string;
  root: string;
  secret: string;
}

export interface IPrivacyProofResult {
  proof: string;
  publicSignals: string[];
}

export interface IPrivacyProofProgress {
  completed?: number;
  stage: 'artifacts' | 'witness' | 'proving' | 'verifying';
  total?: number;
}

export interface IPrivacyProofOptions {
  assertCurrent: () => void;
  onProgress?: (progress: IPrivacyProofProgress) => void;
  signal?: AbortSignal;
}
