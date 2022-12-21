// import {
//   getSysRpc,
//   getEthRpc,
//   web3Provider,
//   validateSysRpc,
//   getBip44Chain,
//   getFormattedBitcoinLikeNetwork,
//   validateEthRpc,
// } from '@pollum-io/sysweb3-network';

import MainController from 'scripts/Background/controllers/MainController';
import store from 'state/store';

jest.useFakeTimers('legacy');

describe('main controller tests', () => {
  beforeAll((done) => {
    done();
  });

  const controller = MainController();

  // //* setPrices
  it('should set autolock timer', () => {
    const payload = 8;

    controller.setAutolockTimer(payload);

    const { timer } = store.getState().vault;

    expect(timer).toEqual(payload);
  });

  it('should return network data', async () => {
    const data = await controller.getNetworkData();

    const response = { chainId: '0x39', networkVersion: '57' };

    expect(data).toStrictEqual(response);
  });

  // it('should get rpc', async () => {
  // const payload = {
  //   label: 'test custom litecoin rpc',
  //   chainId: 2,
  //   isSyscoinRpc: true,
  //   url: 'https://blockbook-litecoin.binancechain.io/',
  // };

  //   const valid = {
  //     url: 'https://blockbook-litecoin.binancechain.io/',
  //     apiUrl: 'https://blockbook-litecoin.binancechain.io/',
  //     explorer: 'https://blockbook-litecoin.binancechain.io/',
  //     currency: 'ltc',
  //     label: 'Litecoin',
  //     default: false,
  //     chainId: 2,
  //   };

  //   const data = await controller.getRpc(payload);

  //   expect(data).toStrictEqual(valid);

  // const data = await validateSysRpc(
  //   'https://blockbook-litecoin.binancechain.io/'
  // );
  // const bip44 = getBip44Chain(data.coin, false);
  // console.log({ data, bip44 });
  // const network = getFormattedBitcoinLikeNetwork(
  //   bip44.chainId,
  //   bip44.nativeCurrency.name
  // );

  // network
  // formattedNetwork: {
  //   url: 'https://blockbook-litecoin.binancechain.io/',
  //     apiUrl: 'https://blockbook-litecoin.binancechain.io/',
  //       explorer: 'https://blockbook-litecoin.binancechain.io/',
  //         currency: 'ltc',
  //           label: 'Litecoin',
  //       default: false,
  //     chainId: 2;
  // },
  // formattedBitcoinLikeNetwork: { networks: [Object], types: [Object]; }

  // data: { valid: true, coin: 'Litecoin', chain: 'main'; },
  // bip44: {
  //   nativeCurrency: { name: 'Litecoin', symbol: 'ltc', decimals: 8; },
  //   coinType: 2147483650,
  //     chainId: 2;
  // },
  // network: {
  //   networks: { mainnet: [Object], testnet: [Object]; },
  //   types: { xPubType: [Object], zPubType: [Object]; }
  // },

  // const data2 = await getSysRpc(payload);

  // console.log({ data, bip44, network, data2 });
  // });

  it('should add a custom rpc', async () => {
    // const payload2 = {
    //   label: 'test custom litecoin rpc',
    //   chainId: 2,
    //   isSyscoinRpc: true,
    //   url: 'https://blockbook-litecoin.binancechain.io/',
    // };

    const payload = {
      label: 'test custom optimism rpc',
      chainId: 10,
      isSyscoinRpc: false,
      url: ' https://mainnet.optimism.io',
    };

    const data = await controller.addCustomRpc(payload);

    const { networks } = store.getState().vault;

    expect(networks.ethereum[payload.chainId]).toBeDefined();
    expect(networks.ethereum[payload.chainId]).toStrictEqual(data);
  });

  it('should throw an error if chain id is invalid for given url', async () => {
    const payload = {
      label: 'edited test custom arbitrum rpc',
      chainId: 10,
      isSyscoinRpc: false,
      url: 'https://arb1.arbitrum.io/rpc',
    };

    const old = {
      label: 'test custom optimism rpc',
      chainId: 10,
      isSyscoinRpc: false,
      url: ' https://mainnet.optimism.io',
    };

    await expect(controller.editCustomRpc(payload, old)).rejects.toThrow(
      new Error('RPC invalid. Endpoint returned a different Chain ID.')
    );
  });

  it('should throw an error if url is invalid for given chain id', async () => {
    const payload = {
      label: 'edited test custom arbitrum rpc',
      chainId: 10,
      isSyscoinRpc: false,
      url: 'https://arb1.arbitrum.io/rpc',
    };

    const old = {
      label: 'test custom optimism rpc',
      chainId: 10,
      isSyscoinRpc: false,
      url: ' https://mainnet.optimism.io',
    };

    // this can take some time because it is trying to fetch an invalid rpc, but this should not exceed timeout of 10000 ms
    await expect(controller.editCustomRpc(payload, old)).rejects.toThrowError();
  });

  it('should edit a custom rpc', async () => {
    const payload = {
      label: 'edited test custom arbitrum rpc',
      chainId: 42161,
      isSyscoinRpc: false,
      url: 'https://arb1.arbitrum.io/rpc',
    };

    const old = {
      label: 'test custom optimism rpc',
      chainId: 10,
      isSyscoinRpc: false,
      url: ' https://mainnet.optimism.io',
    };

    const newChainId =
      old.chainId !== payload.chainId ? payload.chainId : old.chainId;

    const edited = await controller.editCustomRpc(payload, old);

    const { networks } = store.getState().vault;

    expect(networks.ethereum[newChainId]).toStrictEqual(edited);
  });

  it('should return the recommended gas fee according to utxo network', async () => {
    const fee = await controller.getRecommendedFee();

    expect(fee).toBeCloseTo(0.00002);
    expect(typeof fee).toBe('number');
    expect(fee).toBeLessThan(1);
    expect(fee).toBe(0.00001);
  });

  /** wallet */
  // it('should forget wallet', () => {
  //   controller.forgetWallet('a@123');

  //   const { accounts, lastLogin } = store.getState().vault;

  //   expect(accounts).toBe({});
  //   expect(lastLogin).toBe(0);
  // });
});
