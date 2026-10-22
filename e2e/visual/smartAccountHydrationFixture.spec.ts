import { expect, test, type BrowserContext } from '@playwright/test';

import {
  paliEcdsaValidatorInterface,
  paliGuardianRecoveryModuleInterface,
  paliP256WebAuthnValidatorInterface,
  paliSlhDsaValidatorInterface,
  paliCompositeValidatorInterface,
  paliSmartAccountInterface,
} from '../../source/utils/smartAccount/contracts';
import { createSmartAccountHydrationFixture } from '../harness/smartAccountHydrationFixture';
import { VISUAL_FIXTURE_RPC } from '../harness/visualFixture';

const rpc = (method: string, params: unknown[] = [], id = 1) => ({
  jsonrpc: '2.0',
  method,
  params,
  id,
});
const url = `${VISUAL_FIXTURE_RPC}/`;
const foreign = '0x2222222222222222222222222222222222222222';

test('synthetic deployment remains off until explicitly set after ordinary UI creation', async () => {
  const fixture = createSmartAccountHydrationFixture();
  const payload = rpc('eth_getCode', [
    fixture.base.smartAccountAddress,
    'latest',
  ]);
  expect((await fixture.read(url, 'POST', payload))?.body).toMatchObject({
    result: '0x',
  });
  fixture.state.deployed = true;
  expect((await fixture.read(url, 'POST', payload))?.body).toMatchObject({
    result: '0x60006000f3',
  });
  expect(
    (
      await fixture.read(
        url,
        'POST',
        rpc('eth_getCode', [fixture.base.address, 'latest'])
      )
    )?.body
  ).toMatchObject({ result: '0x' });
});

test('returns canonical ABI data only for the known ECDSA account and guardian policy', async () => {
  const fixture = createSmartAccountHydrationFixture();
  fixture.state.deployed = true;
  const call = async (to: string, data: string) =>
    (await fixture.read(url, 'POST', rpc('eth_call', [{ to, data }, 'latest'])))
      ?.body as { error?: unknown; result?: string };
  const owners = await call(
    fixture.base.validator.address,
    paliEcdsaValidatorInterface.encodeFunctionData('owners', [
      fixture.base.smartAccountAddress,
    ])
  );
  expect(
    paliEcdsaValidatorInterface.decodeFunctionResult(
      'owners',
      owners.result!
    )[0]
  ).toEqual([fixture.base.address]);
  const active = await call(
    fixture.base.smartAccountAddress,
    paliSmartAccountInterface.encodeFunctionData('activeValidator')
  );
  expect(
    paliSmartAccountInterface
      .decodeFunctionResult('activeValidator', active.result!)[0]
      .toLowerCase()
  ).toBe(fixture.base.validator.address.toLowerCase());
  fixture.state.guardianInstalled = true;
  const config = await call(
    fixture.guardianAddress,
    paliGuardianRecoveryModuleInterface.encodeFunctionData('config', [
      fixture.base.smartAccountAddress,
    ])
  );
  expect(
    Array.from(
      paliGuardianRecoveryModuleInterface.decodeFunctionResult(
        'config',
        config.result!
      )[0]
    )
  ).toEqual([BigInt(600), BigInt(1200), BigInt(1), true]);
  const foreignOwners = await call(
    fixture.base.validator.address,
    paliEcdsaValidatorInterface.encodeFunctionData('owners', [foreign])
  );
  expect(foreignOwners.error).toBeDefined();
  expect(
    (await call(fixture.base.smartAccountAddress, '0xdeadbeef')).error
  ).toBeDefined();
});

test('guardian removal is a synthetic chain observation, not a controller result replacement', async () => {
  const fixture = createSmartAccountHydrationFixture();
  fixture.state.deployed = true;
  const payload = rpc('eth_call', [
    {
      to: fixture.base.smartAccountAddress,
      data: paliSmartAccountInterface.encodeFunctionData('isModuleInstalled', [
        2,
        fixture.guardianAddress,
        '0x',
      ]),
    },
    'latest',
  ]);
  fixture.state.guardianInstalled = true;
  const first = (await fixture.read(url, 'POST', payload))?.body as {
    result: string;
  };
  expect(
    paliSmartAccountInterface.decodeFunctionResult(
      'isModuleInstalled',
      first.result
    )[0]
  ).toBe(true);
  fixture.state.guardianInstalled = false;
  const second = (await fixture.read(url, 'POST', payload))?.body as {
    result: string;
  };
  expect(
    paliSmartAccountInterface.decodeFunctionResult(
      'isModuleInstalled',
      second.result
    )[0]
  ).toBe(false);
});

test('read barriers preserve each separate metadata read without providing cached results', async () => {
  const fixture = createSmartAccountHydrationFixture();
  fixture.state.deployed = true;
  fixture.armBarrier();
  const payload = rpc('eth_getCode', [
    fixture.base.smartAccountAddress,
    'latest',
  ]);
  let resolved = 0;
  const first = fixture.read(url, 'POST', payload).then((value) => {
    resolved++;
    return value;
  });
  await fixture.waitForRead(1);
  expect(resolved).toBe(0);
  fixture.releaseRead(1);
  await first;
  const second = fixture.read(url, 'POST', payload).then((value) => {
    resolved++;
    return value;
  });
  await fixture.waitForRead(2);
  expect(fixture.metadataReadCount).toBe(2);
  expect(resolved).toBe(1);
  fixture.releaseAll();
  await second;
  expect(resolved).toBe(2);
});

test('batch reads retain request IDs and refuse writes, unknown ABI and state overrides', async () => {
  const fixture = createSmartAccountHydrationFixture();
  fixture.state.deployed = true;
  const result = await fixture.read(url, 'POST', [
    rpc('eth_chainId', [], 4),
    rpc('eth_sendRawTransaction', ['0x01'], 5),
    rpc(
      'eth_call',
      [{ to: fixture.base.smartAccountAddress, data: '0xdeadbeef' }, 'latest'],
      6
    ),
    rpc(
      'eth_call',
      [
        {
          to: fixture.base.smartAccountAddress,
          data: paliSmartAccountInterface.encodeFunctionData('activeValidator'),
        },
        'latest',
        {},
      ],
      7
    ),
  ]);
  expect(result?.body).toEqual([
    expect.objectContaining({ id: 4, result: '0xdee1' }),
    expect.objectContaining({ id: 5, error: expect.any(Object) }),
    expect.objectContaining({ id: 6, error: expect.any(Object) }),
    expect.objectContaining({ id: 7, error: expect.any(Object) }),
  ]);
  expect(result?.unsupported).toEqual([
    'eth_sendRawTransaction',
    'eth_call',
    'eth_call',
  ]);
  for (const method of [
    'personal_sign',
    'eth_sign',
    'wallet_sendCalls',
    'anvil_setBalance',
    'evm_mine',
  ]) {
    expect(
      (await fixture.read(url, 'POST', rpc(method)))?.unsupported
    ).toContain(method);
  }
});

test('never accepts an RPC URL outside the exact existing synthetic endpoint', async () => {
  const fixture = createSmartAccountHydrationFixture();
  for (const other of [
    'http://rpc-zk.tanenbaum.io/',
    'https://rpc-zk.tanenbaum.io.evil/',
    `${url}?override=1`,
    `${url}bad`,
    'https://user:password@rpc-zk.tanenbaum.io/',
  ]) {
    expect(
      await fixture.read(other, 'POST', rpc('eth_chainId'))
    ).toBeUndefined();
  }
});

test('encodes absent validator metadata rather than inventing extra installed authorities', async () => {
  const fixture = createSmartAccountHydrationFixture();
  fixture.state.deployed = true;
  for (const [id, iface, fn] of [
    ['p256WebAuthnValidator', paliP256WebAuthnValidatorInterface, 'authData'],
    ['slhDsaValidator', paliSlhDsaValidatorInterface, 'authData'],
    ['compositeValidator', paliCompositeValidatorInterface, 'childValidators'],
  ] as const) {
    const target = fixture.base.infrastructure.find(
      (contract) => contract.id === id
    )!.address;
    const value = await fixture.read(
      url,
      'POST',
      rpc('eth_call', [
        {
          to: target,
          data: iface.encodeFunctionData(fn, [
            fixture.base.smartAccountAddress,
          ]),
        },
        'latest',
      ])
    );
    expect(value?.unsupported).toEqual([]);
    const decoded = iface.decodeFunctionResult(
      fn,
      (value!.body as { result: string }).result
    )[0];
    if (fn === 'childValidators') expect(Array.from(decoded)).toEqual([]);
    else
      expect(Array.from(decoded)).toEqual(
        expect.arrayContaining([`0x${'00'.repeat(32)}`])
      );
  }
});

test('browser interceptor cannot forward an unknown or signing request outside its local document', async () => {
  const fixture = createSmartAccountHydrationFixture();
  let intercept!: (route: any) => Promise<unknown>;
  await fixture.install(
    {
      route: async (_pattern: string, handler: typeof intercept) => {
        intercept = handler;
      },
    } as unknown as BrowserContext,
    'http://127.0.0.1:12345'
  );
  const call = async (
    requestUrl: string,
    method: string,
    payload?: unknown
  ) => {
    const outcome: Record<string, unknown> = {};
    await intercept({
      request: () => ({
        url: () => requestUrl,
        method: () => method,
        postDataJSON: () => payload,
      }),
      continue: () => {
        outcome.continued = true;
      },
      abort: () => {
        outcome.aborted = true;
      },
      fulfill: (response: unknown) => {
        outcome.fulfilled = response;
      },
    });
    return outcome;
  };
  expect(await call('http://127.0.0.1:12345/', 'GET')).toEqual({
    continued: true,
  });
  expect(await call('http://127.0.0.1:12345/sign', 'POST')).toEqual({
    aborted: true,
  });
  expect(
    await call(url, 'POST', rpc('eth_sendRawTransaction', ['0x01']))
  ).toEqual({ aborted: true });
  expect(await call('https://external.invalid/', 'GET')).toEqual({
    aborted: true,
  });
  expect(await call(url, 'POST', rpc('eth_chainId'))).toHaveProperty(
    'fulfilled'
  );
  expect(fixture.audit.deniedWrites).toEqual(['eth_sendRawTransaction']);
});
