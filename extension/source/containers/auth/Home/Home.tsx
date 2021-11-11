import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Icon, IconButton, Button, ModalBlock } from 'components/index';
import Header from 'containers/common/Header';
import { useController } from 'hooks/index';
import { useFiat } from 'hooks/usePrice';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';

import { formatNumber } from '../helpers';
import { useHistory } from 'react-router-dom';

import TxsPanel from './TxsPanel';

const Home = () => {
  const controller = useController();
  const history = useHistory();
  const getFiatAmount = useFiat();

  const {
    accounts,
    activeAccountId,
    changingNetwork,
    activeNetwork,
  }: IWalletState = useSelector((state: RootState) => state.wallet);

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

          <section className="flex justify-center items-center flex-col gap-4 text-brand-white bg-brand-green">
            {changingNetwork ? (
              <Icon name="loading" className="w-4 bg-brand-gray200 text-brand-navy" />
            ) : (
              <h3>
                {formatNumber(
                  accounts.find((element) => element.id === activeAccountId)
                    ?.balance || 0
                )}{' '}
                <small>{activeNetwork == 'testnet' ? 'TSYS' : 'SYS'}</small>
              </h3>
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

            <IconButton onClick={handleRefresh} type="primary" shape="circle">
              <Icon name="reload" className="bg-brand-gray200 text-brand-navy w-4" />
            </IconButton>

            <div >
              <Button
                type="button"
                onClick={() => history.push('/send')}
              >
                Send
              </Button>
              <Button
                type="button"
                onClick={() => history.push('/receive')}
              >
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
