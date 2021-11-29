import { Button } from 'antd';
import { Icon } from 'components/Icon';
import React, { FC } from 'react';

interface IActivityPanel {
  show: boolean;
  className: any
}

export const ActivityPanel: FC<IActivityPanel> = ({ show, className }) => {
  return (
    <ul className={className}>
     
      {show ? (
        <>
          {/*<ul>show activity panel</ul>*/}
          <ul>
            <li className="border-dashed border-b border-gray-400">
              <div className="bg-brand-navydarker text-sm">
                17-09-21
              </div>
              <div className="grid grid-cols-3 gap-1 text-sm">
                <div>
                  <p>0x3126...7d3864c983</p>
                  <p>Pending</p>
                </div>
                <div>
                  <p>2:55AM</p>
                </div> 
                <div className="col-end-4">
                  <Button className="w-1">
                    <Icon name="select" className="inline-flex self-center text-lg" maxWidth={"1"}></Icon>
                  </Button>
                </div>
              </div> 
            </li>
          </ul>
        </>
      ) : (
        <>
          <p className="justify-center items-center text-sm text-brand-gray">
            You have no transaction history.
          </p>

          {/* {!changingNetwork && (
            <img src={`/${SyscoinIcon}`} className="w-40 max-w-40 mx-auto mt-8" alt="Syscoin" />
          )} */}
        </>
      )}
      {/* {transactions.map((tx: Transaction, idx: number) => {
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
                {isConfirmed ? null : <Icon name="loading" className="w-4 bg-brand-gray200 text-brand-navy" />}
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
      })} */}
    </ul>
  )
}
