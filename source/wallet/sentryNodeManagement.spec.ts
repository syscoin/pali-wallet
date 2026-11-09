import { SENTRY_NETWORKS } from '../shared/sentryNetworks';

import {
  createSentryCollateralCoordinator,
  createSentryCollateralRegistry,
  type SentryCollateralReservation,
} from './sentryCollateral';
import { createSentryNodeManagement } from './sentryNodeManagement';

const node = {
  proTxHash: 'ab'.repeat(32),
  collateralOutpoint: { txid: 'cd'.repeat(32), vout: 1 },
  service: '127.0.0.1:8369',
  nevmAddress: '',
};
const reservation = { ...node.collateralOutpoint, proTxHash: node.proTxHash };
const request = {
  version: 1,
  genesisHash: SENTRY_NETWORKS.mainnet.genesisHash,
  proTxHash: node.proTxHash,
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function fixture() {
  let scope = { id: 'session' };
  let now = 1000;
  let sequence = 0;
  let serviceUrl = 'https://sentry.example';
  let observedNode = node;
  let collateral: SentryCollateralReservation[] = [];
  let linkedNodes: (typeof node)[] = [];
  const checkScope = (captured: typeof scope) => {
    if (captured !== scope)
      throw new Error('Wallet account, network or session changed');
  };
  const write = jest.fn(async (_key, items, check, expectedRaw, linkedNode) => {
    check();
    if (expectedRaw !== collateral)
      throw new Error('Sentry collateral changed');
    collateral = items;
    if (linkedNode)
      linkedNodes = [
        ...linkedNodes.filter(
          (entry) => entry.proTxHash !== linkedNode.proTxHash
        ),
        linkedNode,
      ];
  });
  const registry = createSentryCollateralRegistry(
    {
      keyFor: async () => 'collateral',
      read: async () => collateral,
      write,
    },
    createSentryCollateralCoordinator()
  );
  const registryScope = {
    walletIdentity: 'wallet',
    genesisHash: request.genesisHash,
  };
  const fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          chain: { genesisHash: request.genesisHash },
          node: observedNode,
        })
      )
  );
  const authenticate = jest.fn(async (_scope, password, check) => {
    check();
    if (password !== 'password') throw new Error('Invalid password');
  });
  const commitLink = jest.fn(async (_scope, link, check) =>
    registry.reserveSentryCollateral({
      ...registryScope,
      admission: link.admission,
      linkedNode: link.node,
      reservation: {
        ...link.node.collateralOutpoint,
        proTxHash: link.node.proTxHash,
      },
      assertCurrent: check,
    })
  );
  const release = jest.fn(async (_scope, _network, item, check) =>
    registry.releaseSentryCollateral({
      ...registryScope,
      reservation: item,
      assertCurrent: check,
    })
  );
  let tail = Promise.resolve();
  let requestCurrent = true;
  const manager = createSentryNodeManagement({
    assertCurrent: checkScope,
    authenticate,
    captureAdmission: async () =>
      registry.captureSentryCollateralAdmission(registryScope),
    captureScope: () => scope,
    captureLinkScope: () => ({
      scope,
      assertCurrent: () => {
        if (!requestCurrent) throw new Error('Site approval retired');
      },
    }),
    commitLink,
    createId: () => `review-${++sequence}`,
    fetch,
    network: () => 'mainnet',
    now: () => now,
    readSettings: async () => ({
      network: 'mainnet',
      serviceUrl,
      linkedNodes,
      collateral,
    }),
    releaseCollateral: release,
    runExclusive<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation);
      tail = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
  });
  return {
    manager,
    registry,
    registryScope,
    authenticate,
    commitLink,
    release,
    fetch,
    write,
    revokeRequest: () => {
      requestCurrent = false;
    },
    changeScope: () => {
      scope = { id: 'other-session' };
    },
    expire: () => {
      now += 10 * 60 * 1000;
    },
    setService: (value: string) => {
      serviceUrl = value;
    },
    setNode: (value: typeof node) => {
      observedNode = value;
    },
    setCollateral: (items: SentryCollateralReservation[]) => {
      collateral = items;
    },
    state: () => ({ collateral, linkedNodes }),
  };
}

it('links only the frozen reviewed identity through one atomic registry commit without authentication', async () => {
  const f = fixture();
  const review = await f.manager.prepareLink(
    { ...request, proTxHash: request.proTxHash.toUpperCase() },
    'Pali wallet'
  );
  expect(Object.isFrozen(review)).toBe(true);
  expect(Object.isFrozen(review.node.collateralOutpoint)).toBe(true);
  expect(review.node).toEqual(node);
  expect(await f.manager.confirmLink(review)).toEqual({
    version: 1,
    linked: true,
    proTxHash: node.proTxHash,
    genesisHash: request.genesisHash,
  });
  expect(f.write).toHaveBeenCalledTimes(1);
  expect(f.state()).toEqual({ collateral: [reservation], linkedNodes: [node] });
  expect(f.authenticate).not.toHaveBeenCalled();
  expect(f.fetch).toHaveBeenCalledTimes(2);
  await expect(f.manager.confirmLink(review)).rejects.toThrow('expired');
});

it('refuses a substituted review even when its fields match', async () => {
  const f = fixture();
  const review = await f.manager.prepareLink(request, 'Pali wallet');
  await expect(f.manager.confirmLink({ ...review })).rejects.toThrow(
    'review changed'
  );
  expect(f.commitLink).not.toHaveBeenCalled();
});

it.each([
  { ...node, service: '127.0.0.1:8370' },
  { ...node, nevmAddress: `0x${'11'.repeat(20)}` },
  { ...node, collateralOutpoint: { txid: 'ef'.repeat(32), vout: 1 } },
  { ...node, collateralOutpoint: { ...node.collateralOutpoint, vout: 2 } },
])(
  'requires the exact fresh node fields before committing %j',
  async (changed) => {
    const f = fixture();
    const review = await f.manager.prepareLink(request, 'Pali wallet');
    f.setNode(changed);
    await expect(f.manager.confirmLink(review)).rejects.toThrow(
      'state changed after review'
    );
    expect(f.write).not.toHaveBeenCalled();
  }
);

it('refuses a changed trusted origin without requesting the replacement service', async () => {
  const f = fixture();
  const review = await f.manager.prepareLink(request, 'Pali wallet');
  f.setService('https://other.example');
  await expect(f.manager.confirmLink(review)).rejects.toThrow(
    'state changed after review'
  );
  expect(f.fetch).toHaveBeenCalledTimes(1);
  expect(f.write).not.toHaveBeenCalled();
});

it('cancels a fresh read before any persistent mutation', async () => {
  const f = fixture();
  const review = await f.manager.prepareLink(request, 'Pali wallet');
  const entered = deferred<void>();
  const response = deferred<Response>();
  f.fetch.mockImplementationOnce(async () => {
    entered.resolve();
    return response.promise;
  });
  const confirming = f.manager.confirmLink(review);
  await entered.promise;
  f.manager.cancelLink(review.id);
  response.resolve(new Response('{}'));
  await expect(confirming).rejects.toThrow('cancelled or expired');
  expect(f.commitLink).not.toHaveBeenCalled();
});

it('refuses a dapp-revoked link after its fresh read without blocking wallet-only registry management', async () => {
  const f = fixture();
  const review = await f.manager.prepareLink(request, 'https://dapp.example');
  const entered = deferred<void>();
  const response = deferred<Response>();
  f.fetch.mockImplementationOnce(async () => {
    entered.resolve();
    return response.promise;
  });
  const confirming = f.manager.confirmLink(review);
  await entered.promise;
  f.revokeRequest();
  response.resolve(
    new Response(
      JSON.stringify({ chain: { genesisHash: request.genesisHash }, node })
    )
  );
  await expect(confirming).rejects.toThrow('Site approval retired');
  expect(f.commitLink).not.toHaveBeenCalled();
  await expect(f.manager.list()).resolves.toMatchObject({ network: 'mainnet' });
  f.setCollateral([reservation]);
  await expect(
    f.manager.releaseCollateral({
      reservation,
      password: 'password',
      acknowledgeNodeStops: true,
    })
  ).resolves.toEqual(reservation);
});

it('rechecks the original scope after queued work and refuses expired reviews', async () => {
  const f = fixture();
  const review = await f.manager.prepareLink(request, 'Pali wallet');
  const started = deferred<void>();
  const finish = deferred<void>();
  f.authenticate.mockImplementationOnce(async () => {
    started.resolve();
    await finish.promise;
  });
  f.setCollateral([reservation]);
  const release = f.manager.releaseCollateral({
    reservation,
    password: 'password',
    acknowledgeNodeStops: true,
  });
  await started.promise;
  const queued = f.manager.confirmLink(review);
  f.changeScope();
  finish.resolve();
  await expect(release).rejects.toThrow('session changed');
  await expect(queued).rejects.toThrow('session changed');
  expect(f.commitLink).not.toHaveBeenCalled();
  const another = fixture();
  const expired = await another.manager.prepareLink(request, 'Pali wallet');
  another.expire();
  await expect(another.manager.confirmLink(expired)).rejects.toThrow('expired');
});

it('retains the original admission across the reread and rejects an intervening signature release', async () => {
  const f = fixture();
  const review = await f.manager.prepareLink(request, 'Pali wallet');
  await f.registry.withSentryCollateralSignatureRelease(
    f.registryScope,
    async (mark) => {
      mark();
    }
  );
  await expect(f.manager.confirmLink(review)).rejects.toThrow(
    'transaction changed'
  );
  expect(f.write).not.toHaveBeenCalled();
  expect(f.state()).toEqual({ collateral: [], linkedNodes: [] });
});

it('does not report success or leave partial state when the atomic host write fails', async () => {
  const f = fixture();
  const review = await f.manager.prepareLink(request, 'Pali wallet');
  f.write.mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(f.manager.confirmLink(review)).rejects.toThrow(
    'Storage unavailable'
  );
  expect(f.state()).toEqual({ collateral: [], linkedNodes: [] });
  await expect(f.manager.confirmLink(review)).resolves.toMatchObject({
    linked: true,
  });
});

it('finishes an admitted atomic link if cancellation arrives after the commit boundary', async () => {
  const f = fixture();
  const review = await f.manager.prepareLink(request, 'Pali wallet');
  const started = deferred<void>();
  const finish = deferred<void>();
  const commit = f.commitLink.getMockImplementation()!;
  f.commitLink.mockImplementationOnce(async (...args) => {
    started.resolve();
    await finish.promise;
    await commit(...args);
  });
  const confirming = f.manager.confirmLink(review);
  await started.promise;
  f.manager.cancelLink(review.id);
  finish.resolve();
  await expect(confirming).resolves.toMatchObject({ linked: true });
  expect(f.state()).toEqual({ collateral: [reservation], linkedNodes: [node] });
});

it('requires explicit stop acknowledgement and fresh password before exact reservation release', async () => {
  const f = fixture();
  f.setCollateral([reservation]);
  await expect(
    f.manager.releaseCollateral({
      reservation,
      password: 'password',
      acknowledgeNodeStops: false,
    })
  ).rejects.toThrow('Confirm');
  expect(f.authenticate).not.toHaveBeenCalled();
  await expect(
    f.manager.releaseCollateral({
      reservation,
      password: 'wrong',
      acknowledgeNodeStops: true,
    })
  ).rejects.toThrow('Invalid password');
  expect(f.release).not.toHaveBeenCalled();
  await expect(
    f.manager.releaseCollateral({
      reservation: { ...reservation, proTxHash: 'ff'.repeat(32) },
      password: 'password',
      acknowledgeNodeStops: true,
    })
  ).rejects.toThrow('not found');
  expect(f.state().collateral).toEqual([reservation]);
  await expect(
    f.manager.releaseCollateral({
      reservation,
      password: 'password',
      acknowledgeNodeStops: true,
    })
  ).resolves.toEqual(reservation);
  expect(f.state().collateral).toEqual([]);
});

it('releases pending reservations exactly and preserves linked public identities', async () => {
  const f = fixture();
  const review = await f.manager.prepareLink(request, 'Pali wallet');
  await f.manager.confirmLink(review);
  const pending = {
    txid: '11'.repeat(32),
    vout: 0,
    pendingRegistration: true as const,
  };
  f.setCollateral([reservation, pending]);
  await f.manager.releaseCollateral({
    reservation: pending,
    password: 'password',
    acknowledgeNodeStops: true,
  });
  expect(f.state()).toEqual({ collateral: [reservation], linkedNodes: [node] });
});

it('refuses new and pending work after disposal', async () => {
  const f = fixture();
  const review = await f.manager.prepareLink(request, 'Pali wallet');
  f.manager.dispose();
  await expect(f.manager.confirmLink(review)).rejects.toThrow('expired');
  await expect(f.manager.prepareLink(request, 'Pali wallet')).rejects.toThrow(
    'closed'
  );
  await expect(f.manager.list()).rejects.toThrow('closed');
  expect(f.write).not.toHaveBeenCalled();
});
