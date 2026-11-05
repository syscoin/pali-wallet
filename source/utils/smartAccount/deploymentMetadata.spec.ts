/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

import * as deployment from './deployment';
import * as metadata from './deploymentMetadata';

it('projects every public field from the unchanged full deployment descriptors', () => {
  const expected = deployment.PALI_INFRASTRUCTURE_CONTRACTS.map(
    ({ deployCalldata, ...fields }) => {
      void deployCalldata;
      return fields;
    }
  );
  expect(metadata.PALI_INFRASTRUCTURE_METADATA).toEqual(expected);
  expect(
    Object.keys(metadata.PALI_INFRASTRUCTURE_METADATA_BY_ID).sort()
  ).toEqual(expected.map(({ id }) => id).sort());
  for (const contract of expected)
    expect(metadata.PALI_INFRASTRUCTURE_METADATA_BY_ID[contract.id]).toEqual(
      contract
    );
  const constants = [
    'PALI_CREATE2_DEPLOYER_ADDRESS',
    'PALI_CANONICAL_ENTRYPOINT_ADDRESS',
    'PALI_CREATE2_DEPLOYER_MIN_RUNTIME_BYTE_LENGTH',
    'PALI_INFRASTRUCTURE_VERSION',
    'PALI_MULTICALL3_CANONICAL_ADDRESS',
    'PALI_CANONICAL_FACTORY_ADDRESS',
    'PALI_MODULE_CANONICAL_ADDRESSES',
    'ZKSYS_GAS_TANK_ADDRESSES',
  ] as const;
  for (const name of constants)
    expect(metadata[name]).toEqual(deployment[name]);
});

it.each([undefined, 0, 1, 11155111, 57057, 8453, Number.MAX_SAFE_INTEGER])(
  'preserves public address resolution for chain %s',
  (chainId) => {
    expect(metadata.getPaliCanonicalEntryPointAddress(chainId)).toBe(
      deployment.getPaliCanonicalEntryPointAddress(chainId)
    );
    expect(metadata.getPaliCanonicalFactoryAddress(chainId)).toBe(
      deployment.getPaliCanonicalFactoryAddress(chainId)
    );
    expect(metadata.getZkSysGasTankAddress(chainId)).toBe(
      deployment.getZkSysGasTankAddress(chainId)
    );
  }
);

it('keeps the generated metadata free of runtime module imports', () => {
  const file = resolve(__dirname, 'deploymentMetadata.ts');
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement))
      expect(statement.importClause?.isTypeOnly).toBe(true);
    if (ts.isExportDeclaration(statement))
      expect(statement.isTypeOnly).toBe(true);
  }
});

it('reproduces the committed metadata with the deterministic drift check', () => {
  const root = resolve(__dirname, '../../..');
  expect(
    execFileSync(
      process.execPath,
      ['scripts/generate-deployment-metadata.cjs', '--check'],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 10000,
      }
    )
  ).toContain('Deployment metadata matches every computed descriptor.');
});
