import React, { useEffect, useState } from 'react';
import { Button, Icon, ModalBlock } from 'components/index';
import { useController, useStore, useFiat, useFormat } from 'hooks/index';
import { useHistory } from 'react-router-dom';

import Header from 'containers/common/Header';
import {TxsPanel} from './TxsPanel';
import { ArrowDownOutlined, ArrowUpOutlined, ReloadOutlined } from '@ant-design/icons';

export const Home = () => {
  const controller = useController();
  const history = useHistory();
  const getFiatAmount = useFiat();

  const { formatNumber } = useFormat();

  const {
    accounts,
    activeAccountId,
    changingNetwork,
    activeNetwork,
  } = useStore();

  const [openBlockExplorer, setOpenBlockExplorer] = useState<boolean>(false);
  const [openAssetBlockExplorer, setOpenAssetBlockExplorer] =
    useState<boolean>(false);
  const [txidSelected, setTxidSelected] = useState('');
  const [assetSelected, setAssetSelected] = useState(-1);
  const [txType, setTxType] = useState('');
  const [assetType, setAssetType] = useState('');
  const sysExplorer = controller.wallet.account.getSysExplorerSearch();
  const [tx, setTx] = useState(null);
  const [assetTx, setAssetTx] = useState(null);

  const handleRefresh = () => {
    controller.wallet.account.getLatestUpdate();
    controller.wallet.account.watchMemPool(accounts[activeAccountId]);
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

  const handleOpenExplorer = (txid: string) => {
    window.open(`${sysExplorer}/tx/${txid}`);
  };

  const handleOpenAssetExplorer = (assetGuid: number) => {
    window.open(`${sysExplorer}/asset/${assetGuid}`);
  };

  return (
    <div>
      {openBlockExplorer && (
        <div
          onClick={() => {
            setOpenBlockExplorer(false);
          }}
        />
      )}

      {openAssetBlockExplorer && (
        <div
          onClick={() => {
            setOpenAssetBlockExplorer(false);
          }}
        />
      )}

      {openBlockExplorer && (
        <ModalBlock
          title="Open block explorer" // txtype
          message="Would you like to go to view transaction in Sys Block Explorer?"
          setCallback={() => {
            setOpenBlockExplorer(false);
            setTxidSelected('');
            setTx(null);
          }}
          callback={() => handleOpenExplorer(txidSelected)}
          tx={tx}
          txType={txType}
        />
      )}

      {openAssetBlockExplorer && (
        <ModalBlock
          title="Open block explorer" // asset type
          message="Would you like to go to view asset in Sys Block Explorer?"
          setCallback={() => {
            setOpenAssetBlockExplorer(false);
            setAssetSelected(-1);
            setAssetTx(null);
          }}
          callback={() => handleOpenAssetExplorer(assetSelected)}
          assetTx={assetTx}
          assetType={assetType}
        />
      )}

      {accounts.find((element) => element.id === activeAccountId) ? (
        <>
          <Header accountHeader />

          <section className="flex items-center flex-col gap-1 text-brand-white bg-brand-navydarker pb-14">
            <button onClick={handleRefresh} className="ml-10 pl-72">
              <ReloadOutlined />
            </button>

            {changingNetwork ? (
              <Icon name="loading" className="w-4 bg-brand-gray200 text-brand-navy" />
            ) : (
              <div className="flex justify-center">
                <h3 className="text-5xl flex-1">
                  {formatNumber(
                    accounts.find((element) => element.id === activeAccountId)
                      ?.balance || 5268
                  )}{' '}
                </h3>
                <small className="flex-1 ">{activeNetwork == 'testnet' ? 'TSYS' : 'SYS'}</small>
              </div>
              
            )}

            {changingNetwork ? (
              <p style={{ color: 'white' }}>...</p>
            ) : (
              <small style={{ marginTop: '5px', marginBottom: '5px' }}>
                {activeNetwork !== 'testnet'
                  ? getFiatAmount(
                    accounts.find((element) => element.id === activeAccountId)
                      ?.balance || 0
                  )
                  : ''}
              </small>
            )}

            <div className="pt-4">
              <Button
                className="bg-brand-navydarker rounded-l-full border border-brand-deepPink tracking-normal text-base py-1 px-6 cursor-pointer mr-px hover:bg-brand-deepPink"
                type="button"
                onClick={() => history.push('/send')}
              >
                <ArrowUpOutlined rotate={40}/>
                Send
              </Button>
              <button
                className="bg-brand-navydarker rounded-r-full border border-brand-royalBlue tracking-normal text-base py-1 px-6 cursor-pointer ml-px hover:bg-brand-royalBlue"
                type="button"
                onClick={() => history.push('/receive')}
              >
                <ArrowDownOutlined />
                Receive
              </button>
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
            address={
              accounts.find((element) => element.id === activeAccountId)
                ?.address.main || 'no addr'
            }
            transactions={
              accounts.find((element) => element.id === activeAccountId)
                ?.transactions || []
            }
            assets={
              accounts.find((element) => element.id === activeAccountId)
                ?.assets || []
            }
          />
        </>
      ) : (
        <section
        >
          <Icon name="loading" className="w-4 bg-brand-gray200 text-brand-navy" />
        </section>
      )}
    </div>
  );
};

export default Home;
