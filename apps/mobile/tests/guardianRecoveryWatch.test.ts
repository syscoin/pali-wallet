import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PALI_INFRASTRUCTURE_BY_ID } from '../../../source/utils/smartAccount/deployment.ts';
import { createEvmWatchAccount, WatchOnlyAuthority } from '../src/core/watchOnlyAuthority.ts';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import { createGuardianRecoveryFixture, GUARDIAN_FIXTURE_ACCOUNT } from './native-watch-ui/guardianRecoveryFixture.ts';

const RUNTIME = `0x${PALI_INFRASTRUCTURE_BY_ID.guardianRecoveryModule.deployCalldata!.slice(-5662 * 2)}`;
const setup = () => {
  const rpc = createGuardianRecoveryFixture();
  const owner = new WatchOnlyAuthority([createEvmWatchAccount('watch', 'Watch address', GUARDIAN_FIXTURE_ACCOUNT)], {
    readBalance: async () => { throw new Error('Unexpected balance request'); },
  });
  const read = (signal = new AbortController().signal) => owner.readGuardianRecovery((network, address, ownedSignal, check) => {
    const service = new EvmTransferReadRpc(network, { fetch: async (url, init) => {
      const response = await rpc.fetch(url, init);
      if (!response) throw new Error('Unexpected endpoint');
      return response;
    } });
    return service.readGuardianRecoveryStatus(address, ownedSignal, check);
  }, signal, () => undefined);
  return { owner, rpc, read };
};

test('the selected watch account reads the actual canonical guardian policy at one verified block', async () => {
  const { owner, rpc, read } = setup();
  rpc.select('healthy', RUNTIME);
  await assert.rejects(read());
  assert.deepEqual(rpc.methods(), []);
  owner.unlock();
  const result = await read();
  assert.equal(result.status, 'observed');
  if (result.status !== 'observed') return;
  assert.equal(result.observation.account, GUARDIAN_FIXTURE_ACCOUNT);
  assert.equal(result.observation.threshold, 1);
  assert.equal(result.observation.pending?.status, 'pending');
  assert.deepEqual(rpc.methods().slice(-2), ['eth_getBlockByNumber', 'eth_chainId']);
});

test('missing canonical guardian code is unsupported and an actual anchor change is unavailable', async () => {
  const { owner, rpc, read } = setup();
  owner.unlock();
  rpc.select('unsupported', RUNTIME);
  assert.deepEqual(await read(), { status: 'unsupported' });
  rpc.select('reorg', RUNTIME);
  await assert.rejects(read(), /unavailable/);
});

test('locking a watch session aborts in-flight requests and a late response cannot resume the observation', async () => {
  const { owner, rpc, read } = setup();
  owner.unlock();
  rpc.select('hold', RUNTIME);
  const work = read();
  const refused = assert.rejects(work);
  for (let index = 0; !rpc.methods().length && index < 20; index++)
    await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(rpc.methods(), ['eth_chainId', 'eth_getBlockByNumber']);
  owner.lock();
  rpc.release();
  await refused;
  assert.equal(rpc.interrupted(), 2);
  assert.deepEqual(rpc.methods(), ['eth_chainId', 'eth_getBlockByNumber']);
});
