import {
  loadPrivacyProvingKey,
  loadPrivacyWitnessAssets,
} from 'utils/privacy/proverArtifacts';
import {
  encodePrivacyProof,
  privacyPublicSignals,
  validatePrivacyProofInput,
} from 'utils/privacy/proverCore';
import type {
  IPrivacyProofInput,
  IPrivacyProofProgress,
} from 'utils/privacy/proverTypes';

/* eslint-disable @typescript-eslint/no-var-requires */
const createCircuit = require('./witnessFactory.js') as (metadata: any) => any;
const buildGroth16 = require('./groth16Runtime.js') as (
  options: any
) => Promise<any>;
/* eslint-enable @typescript-eslint/no-var-requires */

self.onmessage = async (
  event: MessageEvent<{
    id: string;
    input: IPrivacyProofInput;
    ports: MessagePort[];
  }>
) => {
  self.onmessage = null;
  const { id, input, ports } = event.data;
  let witness: bigint[] | undefined,
    witnessBytes: ArrayBuffer | undefined,
    engine: any;
  const progress = (value: IPrivacyProofProgress) =>
    self.postMessage({ id, type: 'progress', progress: value });
  let prepared: ReturnType<typeof validatePrivacyProofInput> | undefined;
  try {
    if (!Array.isArray(ports) || ports.length !== 2) throw new Error();
    prepared = validatePrivacyProofInput(input);
    const expected = privacyPublicSignals(input);
    progress({ stage: 'artifacts' });
    const [{ metadata, wasmCode }, provingKey] = await Promise.all([
      loadPrivacyWitnessAssets(),
      loadPrivacyProvingKey({ onProgress: progress }),
    ]);
    progress({ stage: 'witness' });
    const circuit = createCircuit(metadata);
    witness = circuit.calculateWitness(prepared);
    if (
      witness.length !== 28300 ||
      witness.slice(1, 7).some((value, i) => value.toString() !== expected[i])
    )
      throw new Error();
    prepared.nullifier = '';
    prepared.secret = '';
    input.nullifier = '';
    input.secret = '';
    witnessBytes = new ArrayBuffer(witness.length * 32);
    const view = new DataView(witnessBytes);
    const mask = BigInt('4294967295');
    for (let i = 0; i < witness.length; i++)
      for (let word = 0; word < 8; word++)
        view.setUint32(
          i * 32 + word * 4,
          Number((witness[i] >> BigInt(word * 32)) & mask),
          true
        );
    witness.fill(BigInt(0));
    witness = undefined;
    let nextPort = 0;
    engine = await buildGroth16({
      wasmInitialMemory: 1000,
      wasmCode,
      workerCount: 2,
      createWorker: () => {
        const port = ports[nextPort++];
        port.start();
        return {
          postMessage: (value: unknown, transfers: Transferable[]) =>
            port.postMessage(value, transfers),
          set onmessage(handler: (message: MessageEvent) => void) {
            port.onmessage = handler;
          },
          terminate: () => port.close(),
        };
      },
    });
    progress({ stage: 'proving' });
    const proof = await engine.proof(witnessBytes, provingKey);
    progress({ stage: 'verifying' });
    const result = encodePrivacyProof(proof, expected);
    self.postMessage({ id, type: 'success', result });
  } catch {
    self.postMessage({ id, type: 'error', error: 'privacy_proof_failed' });
  } finally {
    input.nullifier = '';
    input.secret = '';
    if (prepared) {
      prepared.nullifier = '';
      prepared.secret = '';
    }
    witness?.fill(BigInt(0));
    if (witnessBytes) new Uint8Array(witnessBytes).fill(0);
    engine?.terminate();
    ports?.forEach((port) => port.close());
  }
};
export {};
