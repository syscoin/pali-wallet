import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import {
  getBip44NetworkDetails,
  validateEthRpc,
} from '@pollum-io/sysweb3-network';

import { Header, Icon, Button, Loading } from 'components/index';
import { usePrice, useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { formatNumber } from 'utils/index';

import { TxsPanel } from './TxsPanel';

export const Home = () => {
  const controller = getController();
  const fiat = useSelector((state: RootState) => state.price.fiat);

  const lastLogin = useSelector((state: RootState) => state.vault.lastLogin);
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const isPendingBalances = useSelector(
    (state: RootState) => state.vault.isPendingBalances
  );
  const networks = useSelector((state: RootState) => state.vault.networks);
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  const [fiatPriceValue, setFiatPriceValue] = useState('');
  const [balance, setBalance] = useState(0);
  const [isTestnet, setIsTestnet] = useState(false);
  const [isSyscoinChain, setIsSyscoinChain] = useState(false);

  const { getFiatAmount } = usePrice();

  const { navigate } = useUtils();

  useEffect(() => {
    setIsSyscoinChain(
      Boolean(networks.syscoin[activeNetwork.chainId]) &&
        activeNetwork.url.includes('blockbook')
    );
  }, [activeNetwork.chainId]);

  useEffect(() => {
    const { syscoin, ethereum } = activeAccount.balances;

    setBalance(isSyscoinChain ? syscoin : ethereum);
  }, [activeNetwork]);

  const setMainOrTestNetwork = async () => {
    const { chainId, url } = activeNetwork;

    const { isTestnet: _isTestnet } = isSyscoinChain
      ? await getBip44NetworkDetails(url)
      : await validateEthRpc(chainId, url);

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
    setFiatPrice();
    setMainOrTestNetwork();
  }, [isUnlocked && activeNetwork.chainId]);

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

                <p className="mt-4 font-poppins">
                  {activeNetwork.currency.toUpperCase()}
                </p>
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
