import { FULL_SLH_PHASE_TIMEOUT_MS } from './native-slh-full.ts';

export type SlhResourceEvidence = Readonly<{
  version: 1;
  scope: 'process-lifetime-including-startup';
  startFootprintBytes: number;
  endFootprintBytes: number;
  peakFootprintBytes: number;
  peakResidentBytes: number;
  elapsedMs: number;
  initialThermalState: number;
  finalThermalState: number;
  worstThermalState: number;
  thermalObservations: number;
}>;
export function readSlhResourceEvidence(value: unknown): SlhResourceEvidence {
  const keys = ['version', 'scope', 'startFootprintBytes', 'endFootprintBytes', 'peakFootprintBytes',
    'peakResidentBytes', 'elapsedMs', 'initialThermalState', 'finalThermalState', 'worstThermalState', 'thermalObservations'];
  const record = value as Record<string, unknown> | null;
  const bytes = (input: unknown): input is number => Number.isSafeInteger(input) && Number(input) > 0;
  const thermal = (input: unknown): input is number => Number.isSafeInteger(input) && Number(input) >= 0 && Number(input) <= 3;
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
    Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key)) ||
    record.version !== 1 || record.scope !== 'process-lifetime-including-startup' ||
    !bytes(record.startFootprintBytes) || !bytes(record.endFootprintBytes) ||
    !bytes(record.peakFootprintBytes) || !bytes(record.peakResidentBytes) ||
    record.peakFootprintBytes < Math.max(record.startFootprintBytes, record.endFootprintBytes) ||
    typeof record.elapsedMs !== 'number' || !Number.isFinite(record.elapsedMs) || record.elapsedMs < 0 || record.elapsedMs > FULL_SLH_PHASE_TIMEOUT_MS ||
    !thermal(record.initialThermalState) || !thermal(record.finalThermalState) || !thermal(record.worstThermalState) ||
    record.worstThermalState < Math.max(record.initialThermalState, record.finalThermalState) ||
    !Number.isSafeInteger(record.thermalObservations) || Number(record.thermalObservations) < 2 || Number(record.thermalObservations) > 10000)
    throw Error('FULL_SLH_RESOURCE_EVIDENCE_INVALID');
  return Object.freeze({ ...record }) as SlhResourceEvidence;
}
