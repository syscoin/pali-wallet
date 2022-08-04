import { chains } from 'eth-chains';
import React, { useEffect, useState } from 'react';

import { Header, Icon, Button, Loading } from 'components/index';
import { useStore, usePrice, useUtils } from 'hooks/index';
import { getController } from 'utils/browser';
import { formatNumber } from 'utils/index';

import { TxsPanel } from './TxsPanel';

export const Home = () => {
  const controller = getController();
  const {
    networks,
    activeNetwork,
    fiat,
    activeAccount,
    lastLogin,
    isPendingBalances,
  } = useStore();
  const [fiatPriceValue, setFiatPriceValue] = useState('');
  const [symbol, setSymbol] = useState('SYS');
  const [balance, setBalance] = useState(0);
  const [isTestnet, setIsTestnet] = useState(false);

  const { getFiatAmount } = usePrice();

  const { navigate } = useUtils();

  useEffect(() => {
    const isSyscoinChain =
      Boolean(networks.syscoin[activeNetwork.chainId]) &&
      activeNetwork.url.includes('blockbook');

    const { syscoin, ethereum } = activeAccount.balances;

    setBalance(isSyscoinChain ? syscoin : ethereum);
  }, [activeNetwork]);

  const setChainSymbol = async () => {
    const { nativeCurrency } = chains.getById(activeNetwork.chainId);

    setSymbol(nativeCurrency.symbol);
  };

  const setMainOrTestNetwork = () => {
    const { chain } = chains.getById(activeNetwork.chainId);

    if (chain !== 'SYS') return;

    const _isTestnet = activeNetwork.chainId === 5700;
    // const { isTestnet: _isTestnet } = await validateSysRpc(activeNetwork.url);

    setIsTestnet(_isTestnet);
  };

  const setFiatPrice = () => {
    const amount = getFiatAmount(
      balance || 0,
      4,
      String(fiat.asset).toUpperCase(),
      true
    );

    setFiatPriceValue(String(amount));
  };

  const isUnlocked =
    controller.wallet.isUnlocked() && activeAccount.address !== '';

  useEffect(() => {
    setChainSymbol();
    setFiatPrice();
    setMainOrTestNetwork();
  }, [isUnlocked, activeNetwork]);

  return (
    <div className="scrollbar-styled h-full bg-bkg-3 overflow-auto">
      {activeAccount && lastLogin && isUnlocked && !isPendingBalances ? (
        <>
          <Header accountHeader />

          <section className="flex flex-col gap-1 items-center py-14 text-brand-white bg-bkg-1">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="balance-account flex gap-x-0.5 items-center justify-center">
                <p
                  id="home-balance"
                  className="font-rubik text-5xl font-medium"
                >
                  {formatNumber(balance || 0)}{' '}
                </p>

                <p className="mt-4 font-poppins">{symbol.toUpperCase()}</p>
              </div>

              <p id="fiat-ammount">{isTestnet ? null : fiatPriceValue}</p>
            </div>

            <div className="flex gap-x-0.5 items-center justify-center pt-8 w-3/4 max-w-md">
              <Button
                type="button"
                className="xl:p-18 flex flex-1 items-center justify-center text-brand-white text-base bg-button-primary hover:bg-button-primaryhover border border-button-primary rounded-l-full transition-all duration-300 xl:flex-none"
                id="send-btn"
                onClick={() => navigate('/send')}
              >
                <Icon
                  name="arrow-up"
                  className="w-4"
                  wrapperClassname="mb-2 mr-2"
                  rotate={45}
                />
                Send
              </Button>

              <Button
                type="button"
                className="xl:p-18 flex flex-1 items-center justify-center text-brand-white text-base bg-button-secondary hover:bg-button-secondaryhover border border-button-secondary rounded-r-full transition-all duration-300 xl:flex-none"
                id="receive-btn"
                onClick={() => navigate('/receive')}
              >
                <Icon
                  name="arrow-down"
                  className="w-4"
                  wrapperClassname="mb-2 mr-2"
                />
                Receive
              </Button>
            </div>
          </section>

          <TxsPanel />
        </>
      ) : (
        <Loading opacity={100} />
      )}
    </div>
  );
};
