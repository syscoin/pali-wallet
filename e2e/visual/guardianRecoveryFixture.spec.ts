import { expect, test } from '@playwright/test';
import { AbiCoder, keccak256 } from 'ethers';

import {
  paliGuardianRecoveryModuleInterface,
  paliSmartAccountInterface,
} from '../../source/utils/smartAccount/contracts';
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
  fixture.state.blockNumber++;
  const canceled = await fixture.read(
    `${VISUAL_FIXTURE_RPC}/`,
    'POST',
    request('eth_getStorageAt', [fixture.guardianAddress, scheduleSlot, '0x65'])
  );
  expect(BigInt((canceled!.body as any).result)).toBe(
    BigInt(fixture.state.scheduledAt) | (BigInt(1) << BigInt(56))
  );
});

test('guardian observation fixture does not silently accept storage reads outside its account or block', async () => {
  const fixture = createGuardianRecoveryFixture();
  const activeSlot = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256'],
      [fixture.base.smartAccountAddress, 3]
    )
  );
  for (const params of [
    [fixture.guardianAddress, `0x${'ff'.repeat(32)}`, '0x64'],
    [fixture.guardianAddress, activeSlot, '0x63'],
    [fixture.guardianAddress, activeSlot, '0x65'],
    [fixture.guardianAddress, activeSlot, 'latest'],
    [`0x${'12'.repeat(20)}`, activeSlot, '0x64'],
  ]) {
    const result = await fixture.read(
      `${VISUAL_FIXTURE_RPC}/`,
      'POST',
      request('eth_getStorageAt', params)
    );
    expect((result!.body as any).error).toBeDefined();
    expect(result!.unsupported).toContain('eth_getStorageAt');
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
  expect(result!.unsupported).toEqual([]);
});

test('guardian observation fixture serves previously observed blocks after the head advances', async () => {
  const fixture = createGuardianRecoveryFixture();
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
  const observed = await fixture.read(
    `${VISUAL_FIXTURE_RPC}/`,
    'POST',
    request('eth_getBlockByNumber', ['latest', false])
  );
  const anchor = (observed!.body as any).result;
  const originalSchedule = fixture.state.scheduledAt;
  fixture.state.blockNumber++;
  fixture.state.activeOperation = `0x${'00'.repeat(32)}`;
  fixture.state.scheduledAt++;
  fixture.state.canceled = true;
  const prior = await fixture.read(`${VISUAL_FIXTURE_RPC}/`, 'POST', [
    request('eth_getStorageAt', [
      fixture.guardianAddress,
      activeSlot,
      anchor.number,
    ]),
    request('eth_getStorageAt', [
      fixture.guardianAddress,
      scheduleSlot,
      anchor.number,
    ]),
    request('eth_getBlockByNumber', [anchor.number, false]),
  ]);
  expect(prior?.unsupported).toEqual([]);
  const replies = prior!.body as any[];
  expect(replies[0].result).toBe(fixture.operationId);
  expect(BigInt(replies[1].result)).toBe(BigInt(originalSchedule));
  expect(replies[2].result).toEqual(anchor);
  const current = await fixture.read(`${VISUAL_FIXTURE_RPC}/`, 'POST', [
    request('eth_getStorageAt', [fixture.guardianAddress, activeSlot, '0x65']),
    request('eth_getStorageAt', [
      fixture.guardianAddress,
      scheduleSlot,
      '0x65',
    ]),
  ]);
  expect(current?.unsupported).toEqual([]);
  expect((current!.body as any[])[0].result).toBe(`0x${'00'.repeat(32)}`);
  expect(BigInt((current!.body as any[])[1].result)).toBe(
    BigInt(fixture.state.scheduledAt) | (BigInt(1) << BigInt(56))
  );
});

test('guardian observation fixture preserves installation state at each observed block', async () => {
  const fixture = createGuardianRecoveryFixture();
  fixture.hydrationState.deployed = true;
  fixture.hydrationState.guardianInstalled = true;
  await fixture.read(
    `${VISUAL_FIXTURE_RPC}/`,
    'POST',
    request('eth_getBlockByNumber', ['latest', false])
  );
  fixture.state.blockNumber++;
  fixture.hydrationState.guardianInstalled = false;
  for (const [tag, installed] of [
    ['0x64', true],
    ['0x65', false],
  ] as const) {
    const result = await fixture.read(`${VISUAL_FIXTURE_RPC}/`, 'POST', [
      request('eth_call', [
        {
          to: fixture.guardianAddress,
          data: paliGuardianRecoveryModuleInterface.encodeFunctionData(
            'config',
            [fixture.base.smartAccountAddress]
          ),
        },
        tag,
      ]),
      request('eth_call', [
        {
          to: fixture.base.smartAccountAddress,
          data: paliSmartAccountInterface.encodeFunctionData(
            'isModuleInstalled',
            [2, fixture.guardianAddress, '0x']
          ),
        },
        tag,
      ]),
    ]);
    expect(result?.unsupported).toEqual([]);
    const replies = result!.body as any[];
    expect(
      paliGuardianRecoveryModuleInterface.decodeFunctionResult(
        'config',
        replies[0].result
      )[0].installed
    ).toBe(installed);
    expect(
      paliSmartAccountInterface.decodeFunctionResult(
        'isModuleInstalled',
        replies[1].result
      )[0]
    ).toBe(installed);
  }
});
