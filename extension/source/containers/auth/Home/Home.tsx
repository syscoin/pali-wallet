import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useSelector } from 'react-redux';
import CircularProgress from '@material-ui/core/CircularProgress';
import Spinner from '@material-ui/core/CircularProgress';
import IconButton from '@material-ui/core/IconButton';
import RefreshIcon from '@material-ui/icons/Refresh';
import Header from 'containers/common/Header';
import Button from 'components/Button';
import FullSelect from 'components/FullSelect';
import Modal from 'components/Modal';
import ModalBlock from 'components/ModalBlock';
import { useController } from 'hooks/index';
import { useFiat } from 'hooks/usePrice';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';
import { browser } from 'webextension-polyfill-ts';

import { formatNumber } from '../helpers';
import { getHost } from '../../../scripts/Background/helpers';

import TxsPanel from './TxsPanel';
import styles from './Home.scss';
import axios from 'axios';

const Home = () => {
  const controller = useController();
  const getFiatAmount = useFiat();

  const {
    accounts,
    activeAccountId,
    tabs,
    changingNetwork,
  }: IWalletState = useSelector((state: RootState) => state.wallet);
  const { currentURL } = tabs;

  const [isOpenModal, setIsOpenModal] = useState<boolean>(false);
  const [openBlockExplorer, setOpenBlockExplorer] = useState<boolean>(false);
  const [openAssetBlockExplorer, setOpenAssetBlockExplorer] =
    useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [txidSelected, setTxidSelected] = useState('');
  const [assetSelected, setAssetSelected] = useState(-1);
  const [txType, setTxType] = useState('');
  const [assetType, setAssetType] = useState('');
  const sysExplorer = controller.wallet.account.getSysExplorerSearch();
  const [tx, setTx] = useState(null);
  const [assetTx, setAssetTx] = useState(null);
  const [currentTabURL, setCurrentTabURL] = useState<string>(currentURL);
  // let isTestnet: boolean = false;
  const [isTestnet, setIsTestnet] = useState(false);

  useEffect(() => {
    axios.get(`${sysExplorer}/api/v2`).then((response: any) => {
      const { blockbook, backend } = response.data;

      if (response && blockbook && backend) {
        if (blockbook.coin === 'Syscoin' || blockbook.coin === 'Syscoin Testnet') {
          if (backend.chain === 'main') {
            setIsTestnet(false);
          }
  
          if (backend.chain === 'test') {
            setIsTestnet(true);
          }
        }
      }

      console.log('is testnet after axios get', response, isTestnet)
    });

    console.log('askdkansd')
  }, [changingNetwork]);

  useEffect(() => {
    browser.windows.getAll({ populate: true }).then((windows) => {
      for (const window of windows) {
        const views = browser.extension.getViews({ windowId: window.id });

        if (views) {
          browser.tabs
            .query({ active: true, currentWindow: true })
            .then((tabs) => {
              setCurrentTabURL(String(tabs[0].url));
            });

          return;
        }
      }
    });
  }, [!controller.wallet.isLocked()]);

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

  useEffect(() => {
    const acc = accounts.find((element) => element.id === activeAccountId);

    if (acc && acc.connectedTo !== undefined) {
      if (acc.connectedTo.length > 0) {
        setIsConnected(
          acc.connectedTo.findIndex((url: any) => {
            return url == getHost(currentTabURL);
          }) > -1
        );
        return;
      }

      setIsConnected(false);
    }
  }, [accounts, activeAccountId, currentTabURL]);

  const handleOpenExplorer = (txid: string) => {
    window.open(`${sysExplorer}/tx/${txid}`);
  };

  const handleOpenAssetExplorer = (assetGuid: number) => {
    window.open(`${sysExplorer}/asset/${assetGuid}`);
  };

  const handleSetModalIsOpen = () => {
    setIsOpenModal(!isOpenModal);
  };

  return (
    <div className={styles.wrapper}>
      {isOpenModal && (
        <div
          className={styles.background}
          onClick={() => setIsOpenModal(false)}
        />
      )}

      {openBlockExplorer && (
        <div
          className={styles.background}
          onClick={() => {
            setOpenBlockExplorer(false);
          }}
        />
      )}

      {openAssetBlockExplorer && (
        <div
          className={styles.background}
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
          <Header showLogo showName={false} />
          <section className={styles.account}>
            {accounts.length > 1 ? (
              <FullSelect
                value={String(activeAccountId)}
                options={accounts}
                onChange={(val: string) => {
                  controller.wallet.switchWallet(Number(val));
                  controller.wallet.account.watchMemPool(accounts[Number(val)]);
                }}
              />
            ) : (
              accounts.find((element) => element.id === activeAccountId)?.label
            )}
          </section>
          <section className={styles.center}>
            {isConnected ? (
              <small
                className={styles.connected}
                onClick={() => setIsOpenModal(!isOpenModal)}
              >
                Connected
              </small>
            ) : (
              <small
                className={styles.notConnected}
                onClick={() => setIsOpenModal(!isOpenModal)}
              >
                Not connected
              </small>
            )}

            {isOpenModal && isConnected && (
              <Modal
                title={currentTabURL}
                connected
                callback={handleSetModalIsOpen}
              />
            )}

            {isOpenModal && !isConnected && (
              <Modal
                title={currentTabURL}
                message="This account is not connected to this site. To connect to a sys platform site, find the connect button on their site."
                callback={handleSetModalIsOpen}
              />
            )}

            {changingNetwork ? (
              <Spinner size={25} className={styles.spinner} />
            ) : (
              <h3>
                {formatNumber(
                  accounts.find((element) => element.id === activeAccountId)
                    ?.balance || 0
                )}{' '}
                <small>{isTestnet ? 'TSYS' : 'SYS'}</small>
              </h3>
            )}

            {changingNetwork ? (
              <p style={{ color: 'white' }}>...</p>
            ) : (
              <small style={{ marginTop: '5px', marginBottom: '5px' }}>
                {!isTestnet
                  ? getFiatAmount(
                      accounts.find((element) => element.id === activeAccountId)
                        ?.balance || 0
                    )
                  : ''}
              </small>
            )}

            <IconButton className={styles.refresh} onClick={handleRefresh}>
              <RefreshIcon />
            </IconButton>
            <div className={styles.actions}>
              <Button
                type="button"
                theme="btn-outline-secondary"
                variant={styles.button}
                linkTo="/send"
              >
                Send
              </Button>
              <Button
                type="button"
                theme="btn-outline-primary"
                variant={styles.button}
                linkTo="/receive"
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
          className={clsx(styles.mask, {
            [styles.hide]: accounts.find(
              (element) => element.id === activeAccountId
            ),
          })}
        >
          <CircularProgress className={styles.loader} />
        </section>
      )}
    </div>
  );
};

export default Home;
