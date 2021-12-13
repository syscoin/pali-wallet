/* eslint-disable no-nested-ternary */
import * as React from 'react';
import {
  FC,
  // useCallback,
  useState
} from 'react';
// import { v4 as uuid } from 'uuid';
import { Icon, IconButton, Button } from 'components/index';
// eslint-disable-next-line import/order
import {
  // useController,
  // useStore 
} from 'hooks/index';

// import SyscoinIcon from 'assets/images/logo-s.svg';
import { Transaction, Assets } from 'scripts/types';
import { ActivityPanel, AssetsPanel } from "./Panel/index";

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

export const TxsPanel: FC<ITxsPanel> = ({
  //transactions,
  //assets,
  // setOpenBlockExplorer,
  // setTxidSelected,
  // setAssetSelected,
  // setOpenAssetBlockExplorer,
  // setTxType,
  // setAssetType,
  // getTransactionData,
  // setTx,
  // setAssetTx,
  // getTransactionAssetData
}) => {
  // const controller = useController();
  const [isShowed, setShowed] = useState<boolean>(false);
  const [isActivity, setActivity] = useState<boolean>(true);
  const [scrollArea,
    setScrollArea
  ] = useState<HTMLElement>();

  // const { changingNetwork } = useStore();
  // const { formatDistanceDate, formatCurrency } = useFormat();

  // const isShowedGroupBar = useCallback(
  //   (tx: Transaction, idx: number) => {
  //     return (
  //       idx === 0 ||
  //       new Date(tx.blockTime * 1e3).toDateString() !==
  //       new Date(transactions[idx - 1].blockTime * 1e3).toDateString()
  //     );
  //   },
  //   [transactions]
  // );


  const handleGoTop = () => {
    // eslint-disable-next-line prettier/prettier
    scrollArea!.scrollTo({ top: 0, behavior: 'smooth' });
    setShowed(false);
  };

  // const getTxType = (tx: Transaction) => {
  //   if (tx.tokenType === "SPTAssetActivate") {
  //     return 'SPT creation';
  //   }
  //
  //   if (tx.tokenType === "SPTAssetSend") {
  //     return 'SPT mint';
  //   }
  //
  //   if (tx.tokenType === "SPTAssetUpdate") {
  //     return 'SPT update';
  //   }
  //
  //   return 'Transaction';
  // }

  return (
    <div className="h-60 w-full flex items-center flex-col">
      {!isShowed ? (
        <div className="w-full">
          <Button
            className={!isActivity ? "w-1/2 flex-2 p-2 text-white text-base bg-brand-navyborder" : "flex-2 p-2 text-white text-base w-1/2 bg-brand-navydarker"}
            type="button"
            noStandard
            onClick={() => { setActivity(false) }}
          >
            Assets
          </Button>

          <Button
            className={isActivity ? "w-1/2 flex-2 p-2 text-white text-base bg-brand-navyborder" : "flex-2 p-2 text-white text-base w-1/2 bg-brand-navydarker"}
            type="button"
            noStandard
            onClick={() => { setActivity(true) }}
          >
            Activity
          </Button>
        </div>
      ) : (
        <div >
          {isActivity ? "Activity" : "Assets"}

          <IconButton type="primary" shape="circle" onClick={handleGoTop}>
            <Icon name="vertical-align" className="w-4 bg-brand-gray200 text-brand-navy" />
          </IconButton>
        </div>
      )}

      {/* {changingNetwork && (
        <>
          <span>
            <Icon name="loading" className="w-4 bg-brand-gray200 text-brand-navy" />
          </span>
          <img src={`/${SyscoinIcon}`} className="w-40 max-w-40 mx-auto mt-8" alt="Syscoin" />
        </>
      )} */}

      {isActivity ? (
        <ActivityPanel
          className={isActivity ? "h-full w-full flex-2 p-4 text-white text-base bg-brand-navyborder" : "flex-2 p-4 text-white text-base"}
          show={/* transactions && !changingNetwork */ true}
        />
      ) : (
        <AssetsPanel
          className={!isActivity ? "w-full h-full flex-2 p-4 text-white text-base bg-brand-navyborder" : "flex-2 p-4 text-white text-base"}
          show={/* assets && !changingNetwork */ true}
        />
      )}

    </div>
  );
};
