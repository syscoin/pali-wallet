import {
  PALI_CREATE2_DEPLOYER_ADDRESS,
  PALI_INFRASTRUCTURE_METADATA,
} from './deploymentMetadata';
import {
  projectSmartAccountInfrastructureObservation,
  createSmartAccountInfrastructureReader,
  SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES,
} from './infrastructureObservation';

function observationFixture() {
  let head = { number: '0x10', hash: `0x${'ab'.repeat(32)}` };
  let canonical = head;
  const codes = SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES.map(() => '0x01');
  const provider = {
    verifyConfiguredChainId: jest.fn().mockResolvedValue(undefined),
    send: jest.fn(async (_method, [tag]) =>
      tag === 'latest' ? head : canonical
    ),
  };
  const readCodes = jest.fn(async () => [...codes]);
  const reader = createSmartAccountInfrastructureReader();
  const read = (options = {}) =>
    reader({
      provider,
      readCodes,
      chainId: 1,
      url: 'https://rpc.example',
      assertCurrent: () => undefined,
      ...options,
    });
  return {
    provider,
    readCodes,
    read,
    codes,
    changeHead(number: string, hash: string) {
      head = { number, hash };
      canonical = head;
    },
    reorg() {
      canonical = { ...head, hash: `0x${'cd'.repeat(32)}` };
    },
  };
}

it('reuses only same-endpoint same-chain canonical code and refreshes on force, new block, and reorg', async () => {
  const f = observationFixture();
  const first = await f.read();
  first.contracts[0]!.deployed = false;
  expect((await f.read()).contracts[0]!.deployed).toBe(true);
  expect(f.readCodes).toHaveBeenCalledTimes(1);
  expect(f.readCodes).toHaveBeenLastCalledWith('0x10');
  expect(f.provider.send).toHaveBeenCalledTimes(4);
  await f.read({ forceRefresh: true });
  await f.read({ url: 'https://other.example' });
  await f.read({ chainId: 2 });
  expect(f.readCodes).toHaveBeenCalledTimes(4);
  f.changeHead('0x11', `0x${'bb'.repeat(32)}`);
  await f.read();
  expect(f.readCodes).toHaveBeenCalledTimes(5);
  f.reorg();
  await expect(f.read()).rejects.toThrow('block changed');
  f.changeHead('0x11', `0x${'cd'.repeat(32)}`);
  await f.read();
  expect(f.readCodes).toHaveBeenCalledTimes(6);
});

it('does not cache failed or retired code observations', async () => {
  const f = observationFixture();
  f.readCodes.mockResolvedValueOnce([]);
  await expect(f.read()).rejects.toThrow('Invalid infrastructure code');
  await f.read();
  expect(f.readCodes).toHaveBeenCalledTimes(2);
  let current = true;
  f.readCodes.mockImplementationOnce(async () => {
    current = false;
    return f.codes;
  });
  await expect(
    f.read({
      forceRefresh: true,
      assertCurrent() {
        if (!current) throw new Error('retired');
      },
    })
  ).rejects.toThrow('retired');
});

it('pairs each header with chain verification and does not publish a delayed wrong-chain observation', async () => {
  const f = observationFixture();
  let rejectChain!: (error: Error) => void;
  const delayedChain = new Promise<void>((_resolve, reject) => {
    rejectChain = reject;
  });
  f.provider.verifyConfiguredChainId.mockReturnValueOnce(delayedChain);
  const failed = expect(f.read()).rejects.toThrow('wrong chain');
  expect(f.provider.send).toHaveBeenCalledTimes(1);
  expect(f.readCodes).not.toHaveBeenCalled();
  rejectChain(new Error('wrong chain'));
  await failed;
  await f.read();
  expect(f.readCodes).toHaveBeenCalledTimes(1);
  expect(f.provider.send).toHaveBeenCalledTimes(3);

  f.provider.verifyConfiguredChainId
    .mockResolvedValueOnce(undefined)
    .mockReturnValueOnce(delayedChain);
  await expect(f.read({ url: 'https://fresh.example' })).rejects.toThrow(
    'wrong chain'
  );
  await f.read({ url: 'https://fresh.example' });
  expect(f.readCodes).toHaveBeenCalledTimes(3);
});

it('bounds retained code entries and payload bytes', async () => {
  const f = observationFixture();
  for (let index = 0; index < 9; index++)
    await f.read({ url: `https://rpc${index}.example` });
  await f.read({ url: 'https://rpc0.example' });
  expect(f.readCodes).toHaveBeenCalledTimes(10);
  const large = '0x' + 'aa'.repeat(600000);
  f.readCodes.mockResolvedValue([large, ...f.codes.slice(1)]);
  await f.read({ url: 'https://large.example' });
  await f.read({ url: 'https://large.example' });
  expect(f.readCodes).toHaveBeenCalledTimes(12);
});

it('uses the canonical code order and reports the deployer and optional contracts separately', () => {
  expect(SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES).toEqual([
    PALI_CREATE2_DEPLOYER_ADDRESS,
    ...PALI_INFRASTRUCTURE_METADATA.map(({ address }) => address),
  ]);
  const codes = [
    '0x',
    ...PALI_INFRASTRUCTURE_METADATA.map(({ optional }) =>
      optional ? '0x' : '0xAAbb'
    ),
  ];
  expect(
    projectSmartAccountInfrastructureObservation(11155111, codes)
  ).toMatchObject({
    chainId: 11155111,
    create2Deployer: {
      address: PALI_CREATE2_DEPLOYER_ADDRESS,
      deployed: false,
    },
    missing: ['multicall3'],
    ready: true,
  });

  const factoryIndex = PALI_INFRASTRUCTURE_METADATA.findIndex(
    ({ id }) => id === 'factory'
  );
  codes[0] = '0x00';
  codes[factoryIndex + 1] = '0x';
  expect(
    projectSmartAccountInfrastructureObservation(11155111, codes)
  ).toMatchObject({
    create2Deployer: { deployed: true },
    missing: ['factory', 'multicall3'],
    ready: false,
  });
});

it('rejects missing or malformed code replies rather than reporting missing deployments', () => {
  const codes = SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES.map(() => '0x');
  expect(
    projectSmartAccountInfrastructureObservation(1, codes.slice(1))
  ).toBeUndefined();
  for (const reply of [null, '0x0', '0xzz']) {
    expect(
      projectSmartAccountInfrastructureObservation(1, [
        reply,
        ...codes.slice(1),
      ])
    ).toBeUndefined();
  }
  delete codes[0];
  expect(
    projectSmartAccountInfrastructureObservation(1, codes)
  ).toBeUndefined();
});
