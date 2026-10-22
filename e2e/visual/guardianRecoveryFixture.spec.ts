import { expect, test } from '@playwright/test';
import { AbiCoder, keccak256 } from 'ethers';

import { PALI_INFRASTRUCTURE_BY_ID } from '../../source/utils/smartAccount/deployment';
import { createGuardianRecoveryFixture } from '../harness/guardianRecoveryFixture';
import { VISUAL_FIXTURE_RPC } from '../harness/visualFixture';

const request = (method: string, params: unknown[]) => ({
  jsonrpc: '2.0',
  id: 1,
  method,
  params,
});

test('guardian observation fixture supplies the exact pinned runtime and packed external schedule', async () => {
  const fixture = createGuardianRecoveryFixture();
  expect(keccak256(fixture.runtime)).toBe(
    PALI_INFRASTRUCTURE_BY_ID.guardianRecoveryModule.runtimeCodeHash
  );
  const activeSlot = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256'],
      [fixture.base.smartAccountAddress, 3]
    )
  );
  const scheduleSlot = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint256'],
      [fixture.operationId, 4]
    )
  );
  const result = await fixture.read(`${VISUAL_FIXTURE_RPC}/`, 'POST', [
    request('eth_getCode', [fixture.guardianAddress, '0x64']),
    request('eth_getStorageAt', [fixture.guardianAddress, activeSlot, '0x64']),
    request('eth_getStorageAt', [
      fixture.guardianAddress,
      scheduleSlot,
      '0x64',
    ]),
  ]);
  expect(result?.unsupported).toEqual([]);
  const replies = result!.body as any[];
  expect(replies[0].result).toBe(fixture.runtime);
  expect(replies[1].result).toBe(fixture.operationId);
  expect(BigInt(replies[2].result)).toBe(BigInt(fixture.state.scheduledAt));
  fixture.state.canceled = true;
  const canceled = await fixture.read(
    `${VISUAL_FIXTURE_RPC}/`,
    'POST',
    request('eth_getStorageAt', [fixture.guardianAddress, scheduleSlot, '0x64'])
  );
  expect(BigInt((canceled!.body as any).result)).toBe(
    BigInt(fixture.state.scheduledAt) | (BigInt(1) << BigInt(56))
  );
});

test('guardian observation fixture does not silently accept storage reads outside its account or block', async () => {
  const fixture = createGuardianRecoveryFixture();
  for (const params of [
    [fixture.guardianAddress, `0x${'ff'.repeat(32)}`, '0x64'],
    [fixture.guardianAddress, `0x${'00'.repeat(32)}`, '0x65'],
    [`0x${'12'.repeat(20)}`, `0x${'00'.repeat(32)}`, '0x64'],
  ]) {
    const result = await fixture.read(
      `${VISUAL_FIXTURE_RPC}/`,
      'POST',
      request('eth_getStorageAt', params)
    );
    expect((result!.body as any).error).toBeDefined();
  }
  const write = await fixture.read(
    `${VISUAL_FIXTURE_RPC}/`,
    'POST',
    request('eth_sendRawTransaction', ['0x00'])
  );
  expect((write!.body as any).error).toBeDefined();
});

test('guardian observation fixture provides an explicit failed read rather than a safe-looking empty state', async () => {
  const fixture = createGuardianRecoveryFixture();
  fixture.state.failStorage = true;
  const activeSlot = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256'],
      [fixture.base.smartAccountAddress, 3]
    )
  );
  const result = await fixture.read(
    `${VISUAL_FIXTURE_RPC}/`,
    'POST',
    request('eth_getStorageAt', [fixture.guardianAddress, activeSlot, '0x64'])
  );
  expect((result!.body as any).error).toMatchObject({ code: -32000 });
  expect((result!.body as any).result).toBeUndefined();
});
