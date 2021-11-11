/* eslint-disable no-nested-ternary */
import * as React from 'react';
import { FC, Fragment, useCallback, useState } from 'react';
import { v4 as uuid } from 'uuid';
import Icon from 'components/Icon';
import IconButton from 'components/IconButton';
import Button from 'components/Button';
import { useController } from 'hooks/index';
import SyscoinIcon from 'assets/images/logosys.svg';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';
import { useSelector } from 'react-redux';

import { Transaction, Assets } from '../../../scripts/types';
import { formatDistanceDate, formatCurrency } from '../helpers';

interface ITxsPanel {
  address: string;
  assets: Assets[];
  getTransactionAssetData: any;
  getTransactionData: any;
  openAssetBlockExplorer: any;
  openBlockExplorer: any;
  setAssetSelected: any;
  setAssetTx: any;
  setAssetType: any;
  setOpenAssetBlockExplorer: any;
  setOpenBlockExplorer: any;
  setTx: any;
  setTxType: any;
  setTxidSelected: any;
  transactions: Transaction[];
  txidSelected: any;
}

const TxsPanel: FC<ITxsPanel> = ({ transactions, assets, setOpenBlockExplorer, setTxidSelected, setAssetSelected, setOpenAssetBlockExplorer, setTxType, setAssetType, getTransactionData, setTx, setAssetTx, getTransactionAssetData }) => {
  const controller = useController();
  const [isShowed, setShowed] = useState<boolean>(false);
  const [isActivity, setActivity] = useState<boolean>(true);
  const [scrollArea, setScrollArea] = useState<HTMLElement>();

  const { changingNetwork }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  const isShowedGroupBar = useCallback(
    (tx: Transaction, idx: number) => {
      return (
        idx === 0 ||
        new Date(tx.blockTime * 1e3).toDateString() !==
        new Date(transactions[idx - 1].blockTime * 1e3).toDateString()
      );
    },
    [transactions]
  );

  const handleFetchMoreTxs = () => {
    if (transactions.length) {
      controller.wallet.account.updateTxs();
    }
  };

  const handleScroll = useCallback((event) => {
    event.persist();

    if (event.target.scrollTop) setShowed(true);

    setScrollArea(event.target);
    const scrollOffset = event.target.scrollHeight - event.target.scrollTop;

    if (scrollOffset === event.target.clientHeight) {
      if (!changingNetwork) {
        handleFetchMoreTxs();
      }
    }
  }, []);

  const handleGoTop = () => {
    scrollArea!.scrollTo({ top: 0, behavior: 'smooth' });
    setShowed(false);
  };

  const getTxType = (tx: Transaction) => {
    if (tx.tokenType === "SPTAssetActivate") {
      return 'SPT creation';
    }

    if (tx.tokenType === "SPTAssetSend") {
      return 'SPT mint';
    }

    if (tx.tokenType === "SPTAssetUpdate") {
      return 'SPT update';
    }

    return 'Transaction';
  }

  return (
    <section
      onScroll={handleScroll}
      className="bg-brand-gray text-brand-white flex justify-center items-center flex-col"
    >
      {!isShowed ?
        <div>
          <div>
            <Button
              type="button"
              onClick={() => { setActivity(false) }}
            >
              Assets
            </Button>

            <Button
              type="button"
              onClick={() => { setActivity(true) }}
            >
              Activity
            </Button>
          </div>
        </div>
        :
        <div >
          {isActivity ? "Activity" : "Assets"}
          <IconButton type="primary" shape="circle" onClick={handleGoTop}>
            <Icon name="vertical-align" className="w-4 bg-brand-gray200 text-brand-navy" />
          </IconButton>
        </div>
      }

      {changingNetwork && (
        <>
          <span>
          <Icon name="loading" className="w-4 bg-brand-gray200 text-brand-navy" />
          </span>
          <img src={`/${SyscoinIcon}`} className="w-40 max-w-40 mx-auto mt-8" alt="Syscoin" />
        </>
      )}

      {isActivity ?
        transactions.length && !changingNetwork ? (
          <>
            <ul>
              {transactions.map((tx: Transaction, idx: number) => {
                const isConfirmed = tx.confirmations > 0;

                return (
                  <Fragment key={uuid()}>
                    {isShowedGroupBar(tx, idx) && (
                      <li >
                        {formatDistanceDate(new Date(tx.blockTime * 1000).toDateString())}
                      </li>
                    )}
                    <li
                      onClick={() => {
                        setOpenBlockExplorer(true);
                        setTxidSelected(tx.txid);
                        setTxType(tx.tokenType);
                        getTransactionData(tx.txid).then((response: any) => {
                          setTx(response);
                        })
                      }}>
                      <div>
                        {isConfirmed ? null : <Icon name="loading" className="w-4 bg-brand-gray200 text-brand-navy"/>}
                      </div>
                      <div>
                        <span title="Click here to go to view transaction in sys block explorer">
                          <span>
                            {new Date(tx.blockTime * 1000).toLocaleTimeString(navigator.language, {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                          <small>{tx.txid}</small>
                          <small>{isConfirmed ? "Confirmed" : "Unconfirmed"}</small>
                          <small>{getTxType(tx)}</small>
                        </span>
                        <div>
                          <Icon name="arrow-up" className="w-4 bg-brand-gray200 text-brand-navy" />
                        </div>
                      </div>
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          </>
        ) : (
          <>
            <span>
              You have no transaction history.
            </span>

            {!changingNetwork && (
              <img src={`/${SyscoinIcon}`} className="w-40 max-w-40 mx-auto mt-8" alt="Syscoin" />
            )}
          </>
        ) : assets.length && !changingNetwork ?
          <>
            <ul>
              {assets.map((asset: Assets) => {
                if (asset.assetGuid !== undefined) {
                  return (
                    <Fragment key={uuid()}>
                      <div
                        onClick={() => {
                          setOpenAssetBlockExplorer(true);
                          setAssetSelected(asset.assetGuid);
                          setAssetType(asset.type)
                          getTransactionAssetData(asset.assetGuid).then((response: any) => {
                            setAssetTx(response);
                          })
                        }}
                      >
                        <div>
                          <span title="Click here to go to view transaction in sys block explorer">
                            <span>
                              {formatCurrency(String(asset.balance / 10 ** asset.decimals), asset.decimals)} {asset.symbol}
                            </span>
                          </span>
                          <div>
                            <Icon name="arrow-up" className="w-4 bg-brand-gray200 text-brand-navy" />
                          </div>
                        </div>
                      </div>
                    </Fragment>
                  );
                }
              })}
            </ul>
          </> : <>
            <span>
              You have no tokens or NFTs.
            </span>

            {!changingNetwork && (
              <img src={`/${SyscoinIcon}`} className="w-40 max-w-40 mx-auto mt-8" alt="Syscoin" />
            )}
          </>
      }
    </section>
  );
};

export default TxsPanel;
