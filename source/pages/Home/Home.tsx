import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { validateEthRpc, validateSysRpc } from '@pollum-io/sysweb3-network';

import { Header, Icon, Button, Loading } from 'components/index';
import { usePrice, useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { formatNumber } from 'utils/index';

import { TxsPanel } from './TxsPanel';

export const Home = () => {
  //* Hooks
  const { getFiatAmount } = usePrice();
  const { navigate } = useUtils();

  //* Selectors
  const { asset: fiatAsset, price: fiatPrice } = useSelector(
    (state: RootState) => state.price.fiat
  );
  const lastLogin = useSelector((state: RootState) => state.vault.lastLogin);
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const isPendingBalances = useSelector(
    (state: RootState) => state.vault.isPendingBalances
  );
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const { accounts, isNetworkChanging } = useSelector(
    (state: RootState) => state.vault
  );

  //* States
  const [isTestnet, setIsTestnet] = useState(false);

  //* Constants
  const controller = getController();
  const isUnlocked =
    controller.wallet.isUnlocked() && accounts[activeAccount].address !== '';
  const bgColor = isNetworkChanging ? 'bg-bkg-2' : 'bg-bkg-3';
  const { syscoin: syscoinBalance, ethereum: ethereumBalance } =
    accounts[activeAccount].balances;

  const actualBalance = isBitcoinBased ? syscoinBalance : ethereumBalance;

  //* Functions
  const verifyIfIsTestnet = async () => {
    const { url } = activeNetwork;

    const { chain, chainId }: any = isBitcoinBased
      ? await validateSysRpc(url)
      : await validateEthRpc(url);

    const ethTestnetsChainsIds = [5700, 80001, 11155111, 421611, 5, 69]; // Some ChainIds from Ethereum Testnets as Polygon Testnet, Goerli, Sepolia, etc.

    return Boolean(
      chain === 'test' ||
        chain === 'testnet' ||
        ethTestnetsChainsIds.some(
          (validationChain) => validationChain === chainId
        )
    );
  };

  //* Effect for set Testnet or not
  useEffect(() => {
    if (!isUnlocked) return;

    verifyIfIsTestnet().then((_isTestnet) => setIsTestnet(_isTestnet));
    return () => {
      setIsTestnet(false);
    };
  }, [isUnlocked, activeNetwork, activeNetwork.chainId, isBitcoinBased]);

  //* fiatPriceValue with useMemo to recalculate every time that something changes and be in cache if the value is the same
  const fiatPriceValue = useMemo(() => {
    const getAmount = getFiatAmount(
      actualBalance > 0 ? actualBalance : 0,
      4,
      String(fiatAsset).toUpperCase(),
      true,
      true
    );

    return getAmount;
  }, [
    isUnlocked,
    activeAccount,
    accounts[activeAccount].address,
    activeNetwork,
    activeNetwork.chainId,
    fiatAsset,
    fiatPrice,
    actualBalance,
  ]);

  return (
    <div className={`scrollbar-styled h-full ${bgColor} overflow-auto`}>
      {accounts[activeAccount] &&
      lastLogin &&
      isUnlocked &&
      !isPendingBalances &&
      !isNetworkChanging ? (
        <>
          <Header accountHeader />

          <section className="flex flex-col gap-1 items-center py-14 text-brand-white bg-bkg-1">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="balance-account flex gap-x-0.5 items-center justify-center">
                <p
                  id="home-balance"
                  className="font-rubik text-5xl font-medium"
                >
                  {formatNumber(actualBalance || 0)}{' '}
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
                className="xl:p-18 flex flex-1 items-center justify-center text-brand-white text-base bg-button-secondary hover:bg-button-secondaryhover border border-button-secondary rounded-l-full transition-all duration-300 xl:flex-none"
                id="send-btn"
                onClick={() =>
                  isBitcoinBased ? navigate('/send/sys') : navigate('/send/eth')
                }
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
                className="xl:p-18 flex flex-1 items-center justify-center text-brand-white text-base bg-button-primary hover:bg-button-primaryhover border border-button-primary rounded-r-full transition-all duration-300 xl:flex-none"
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
        <Loading />
      )}
    </div>
  );
};
