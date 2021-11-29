import React, { useEffect, useState } from 'react';
import { Icon, ModalBlock } from 'components/index';
import { useController, useStore, useFiat, useFormat, useUtils } from 'hooks/index';

import { Header } from 'containers/common/Header';
import { TxsPanel } from './TxsPanel';

import { Button } from 'antd';

export const Home = () => {
  const controller = useController();
  const getFiatAmount = useFiat();
  const { history } = useUtils();
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


      {/* you can use this code instead the below (just need to put some style)
{accounts.find((element) => element.id === activeAccountId) ? (
        <>
          <Header accountHeader />

          <section className="flex justify-center items-center flex-col gap-4 text-brand-white bg-brand-green">
            <div className="bg-brand-white text-brand-deepPink100 font-bold">
              {changingNetwork ? (
                <>
                  <Icon name="loading" className="w-4 bg-brand-gray200 text-brand-navy" />
                  <p style={{ color: 'white' }}>...</p>
                </>
              ) : (
                <>
                  <h3>
                    {formatNumber(
                      accounts.find((element) => element.id === activeAccountId)
                        ?.balance || 0
                    )}{' '}
                    <small>{activeNetwork == 'testnet' ? 'TSYS' : 'SYS'}</small>
                  </h3>
                  <small style={{ marginTop: '5px', marginBottom: '5px' }}>
                    {activeNetwork !== 'testnet'
                      ? getFiatAmount(
                        accounts.find((element) => element.id === activeAccountId)
                          ?.balance || 0
                      )
                      : ''}
                  </small>
                </>
              )}
            </div>

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
      )} */}

      {accounts.find((element) => element.id === activeAccountId) ? (
        <>
          <Header accountHeader />

          <section className="flex items-center flex-col gap-1 text-brand-white bg-brand-navydarker pb-14">
            <button onClick={handleRefresh} className="ml-3 pl-72 w-1">
              <Icon name="reload" className="inline-flex self-center text-lg" maxWidth={"1"} />
            </button>

            {changingNetwork ? (
              <Icon name="loading" className="w-4 bg-brand-gray200 text-brand-navy" />
            ) : (
              <div className="flex justify-center">
                <p className="text-5xl flex-1 font-medium">
                  {formatNumber(
                    accounts.find((element) => element.id === activeAccountId)
                      ?.balance || 5268
                  )}{' '}
                </p>
                <p className="flex-1 self-end pl-0.5">{activeNetwork == 'testnet' ? 'TSYS' : 'SYS'}</p>
              </div>

            )}

            {changingNetwork ? (
              <p className="text-royalBlue">...</p>
            ) : (
              <small className="mt-1.5 mb-1.5 text-brand-royalblue">
                {activeNetwork !== 'testnet'
                  ? getFiatAmount(
                    accounts.find((element) => element.id === activeAccountId)
                      ?.balance || 0
                  )
                  : ''}
              </small>
            )}
            <div className="pt-8"> 
              <Button
                className="inline-flex bg-brand-navydarker rounded-l-full border border-brand-deepPink tracking-normal text-base py-1 px-6 cursor-pointer mr-px hover:bg-brand-deepPink"
                onClick={() => history.push('/send')}
              
              >
                <Icon name="arrow-up" className="inline-flex self-center text-sm pr-1 text-brand-deepPink" rotate={40} />
                  Send
              </Button>
              <Button
                className="inline-flex bg-brand-navydarker rounded-r-full border border-brand-royalBlue tracking-normal text-base py-1 px-6 cursor-pointer ml-px hover:bg-brand-royalBlue"
                onClick={() => history.push('/receive')}
              >
                <Icon name="arrow-down" className="inline-flex self-center text-sm pr-1 text-brand-royalBlue" />
                
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
