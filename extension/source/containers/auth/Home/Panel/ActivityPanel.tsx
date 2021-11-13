import React, { FC } from 'react';

interface IActivityPanel {
  show: boolean;
}

export const ActivityPanel: FC<IActivityPanel> = ({ show }) => {
  return (
    <ul>
      activity panel

      {show ? (
        <ul>show activity panel</ul>
      ) : (
        <>
          <span>
            You have no transaction history.
          </span>

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
