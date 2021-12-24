import React, { useEffect, useState } from 'react';
import { Icon } from 'components/index';
import {
  useController,
  useStore,
  useFiat,
  useFormat,
  useUtils,
  useAccount,
} from 'hooks/index';

import { Header } from 'containers/common/Header';
import { TxsPanel } from './TxsPanel';

import { Button } from 'antd';

export const Home = () => {
  const controller = useController();
  const getFiatAmount = useFiat();
  const { history } = useUtils();
  const { formatNumber } = useFormat();

  const { accounts, activeAccountId, activeNetwork } = useStore();

  const [openBlockExplorer, setOpenBlockExplorer] = useState<boolean>(false);
  const [openAssetBlockExplorer, setOpenAssetBlockExplorer] =
    useState<boolean>(false);
  const [txidSelected, setTxidSelected] = useState('');
  const [assetSelected, setAssetSelected] = useState(-1);
  const [txType, setTxType] = useState('');
  const [assetType, setAssetType] = useState('');
  // const sysExplorer = controller.wallet.account.getSysExplorerSearch();
  const [tx, setTx] = useState(null);
  const [assetTx, setAssetTx] = useState(null);
  console.log(assetSelected, txType, assetType, tx, assetTx);

  const { activeAccount } = useAccount();

  const handleRefresh = () => {
    controller.wallet.account.getLatestUpdate();
    controller.wallet.account.watchMemPool(activeAccount);
    controller.stateUpdater();
  };

  const getTransactionData = async (txid: string) => {
    return await controller.wallet.account.getTransactionData(txid);
  };

  const getTransactionAssetData = async (assetGuid: string) => {
    return await controller.wallet.account.getDataAsset(assetGuid);
  };

  useEffect(() => {
    if (
      !controller.wallet.isLocked() &&
      accounts.length > 0 &&
      accounts.find((element) => element.id === activeAccountId)
    ) {
      handleRefresh();
    }
  }, [!controller.wallet.isLocked(), accounts.length > 0]);

  // const handleOpenExplorer = (txid: string) => {
  //   window.open(`${sysExplorer}/tx/${txid}`);
  // };

  // const handleOpenAssetExplorer = (assetGuid: number) => {
  //   window.open(`${sysExplorer}/asset/${assetGuid}`);
  // };

  return (
    <div className="bg-brand-navyborder overflow-auto home">
      {activeAccount ? (
        <>
          <Header accountHeader />

          <section className="flex items-center flex-col gap-1 text-brand-white bg-brand-navydarker pb-14">
            <button onClick={handleRefresh} className="ml-3 pl-72 w-1">
              <Icon name="reload" className="inline-flex self-center text-lg" />
            </button>

            <div className="flex justify-center">
              <p className="text-5xl font-medium font-rubik">
                {formatNumber(activeAccount?.balance || 0)}{' '}
              </p>

              <p className="font-poppins mt-4">
                {activeNetwork == 'testnet' ? 'TSYS' : 'SYS'}
              </p>
            </div>

            <small className="mt-1.5 mb-1.5 text-brand-royalblue">
              {activeNetwork !== 'testnet'
                ? getFiatAmount(
                    accounts.find((element) => element.id === activeAccountId)
                      ?.balance || 0
                  )
                : ''}
            </small>

            <div className="pt-8 w-3/4 flex justify-center items-center gap-x-0.5">
              <Button
                className="flex items-center justify-center flex-1 text-base rounded-l-full border border-brand-deepPink text-brand-white hover:bg-brand-deepPink transition-all duration-300"
                onClick={() => history.push('/send')}
              >
                <Icon
                  name="arrow-up"
                  className="w-4"
                  wrapperClassname="mb-2 mr-2"
                  rotate={40}
                />
                Send
              </Button>

              <Button
                className="flex items-center justify-center flex-1 text-base rounded-r-full border border-brand-royalBlue text-brand-white hover:bg-brand-royalBlue transition-all duration-300"
                onClick={() => history.push('/receive')}
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

          <TxsPanel
            getTransactionAssetData={getTransactionAssetData}
            getTransactionData={getTransactionData}
            setTx={setTx}
            setAssetTx={setAssetTx}
            setAssetType={setAssetType}
            setTxType={setTxType}
            txidSelected={txidSelected}
            setTxidSelected={setTxidSelected}
            setAssetSelected={setAssetSelected}
            openBlockExplorer={openBlockExplorer}
            setOpenBlockExplorer={setOpenBlockExplorer}
            openAssetBlockExplorer={openAssetBlockExplorer}
            setOpenAssetBlockExplorer={setOpenAssetBlockExplorer}
            address={activeAccount?.address.main || 'no addr'}
            transactions={activeAccount?.transactions || []}
            assets={activeAccount?.assets || []}
          />
        </>
      ) : (
        <section>
          <Icon
            name="loading"
            className="w-4 bg-brand-gray200 text-brand-navy"
          />
        </section>
      )}
    </div>
  );
};
