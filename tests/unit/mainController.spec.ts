import {
  getSysRpc,
  getEthRpc,
  web3Provider,
  validateSysRpc,
  getBip44Chain,
  getFormattedBitcoinLikeNetwork,
} from '@pollum-io/sysweb3-network';

import MainController from 'scripts/Background/controllers/MainController';
import store from 'state/store';
describe('main controller tests', () => {
  const controller = MainController();

  //* setPrices
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

  it('should get rpc', async () => {
    const payload = {
      label: 'test custom optimism rpc',
      chainId: 2,
      isSyscoinRpc: true,
      url: 'https://blockbook-litecoin.binancechain.io/',
    };

    const rpc = await controller.getRpc(payload);

    console.log({ rpc });

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
  });

  // it('should add a custom rpc', async () => {
  //   const payload = {
  //     label: 'test custom optimism rpc',
  //     chainId: 10,
  //     isSyscoinRpc: false,
  //     url: ' https://mainnet.optimism.io',
  //   };

  //   // const data = await controller.addCustomRpc(payload);

  //   const { networks } = store.getState().vault;

  //   // console.log({ networks });

  //   // expect(networks.ethereum[payload.chainId]).toBeDefined();
  //   // expect(networks.ethereum[payload.chainId]).toStrictEqual(data);
  // });
  /** wallet */
  // it('should forget wallet', () => {
  //   controller.forgetWallet('a@123');

  //   const { accounts, lastLogin } = store.getState().vault;

  //   expect(accounts).toBe({});
  //   expect(lastLogin).toBe(0);
  // });
});
