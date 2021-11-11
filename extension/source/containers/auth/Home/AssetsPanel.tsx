import React, { FC } from 'react';

interface IAssetsPanel {
  show: boolean;
}

const AssetsPanel: FC<IAssetsPanel> = ({ show }) => {
  return (
    <ul>
      assets panel

      {show ? (
        <ul>show assets panel</ul>
      ) : (
        <span>
          You have no tokens or NFTs.
        </span>

        //       {!changingNetwork && (
        //         <img src={`/${SyscoinIcon}`} className="w-40 max-w-40 mx-auto mt-8" alt="Syscoin" />
        //       )}
        //     </>
      )}

      {/* <ul>
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
      </ul> */}
    </ul>
  )
}

export default AssetsPanel;