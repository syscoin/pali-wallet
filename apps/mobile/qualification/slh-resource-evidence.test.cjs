const assert = require('node:assert/strict');
const test = require('node:test');
const { readSlhResourceEvidence } = require('./slh-resource-evidence.ts');

const evidence = { version: 1, scope: 'process-lifetime-including-startup', startFootprintBytes: 100,
  endFootprintBytes: 200, peakFootprintBytes: 300, peakResidentBytes: 400, elapsedMs: 1000,
  initialThermalState: 0, finalThermalState: 1, worstThermalState: 2, thermalObservations: 3 };
test('SLH resource evidence admits only bounded numeric process peaks and observed thermal states', () => {
  assert.deepEqual(readSlhResourceEvidence(evidence), evidence);
  for (const patch of [{ scope: 'phase-exclusive' }, { peakFootprintBytes: 199 }, { peakResidentBytes: 0 },
    { peakFootprintBytes: Number.MAX_SAFE_INTEGER + 1 }, { elapsedMs: 1800001 }, { elapsedMs: NaN },
    { worstThermalState: 0 }, { worstThermalState: 4 }, { thermalObservations: 1 },
    { thermalObservations: 10001 }, { secret: 'unexpected' }, { startFootprintBytes: undefined }])
    assert.throws(() => readSlhResourceEvidence({ ...evidence, ...patch }));
});
