import { useAccount } from 'hooks/useAccount';
import React, { FC } from 'react';
import { PanelList } from './components/PanelList';

interface IAssetsPanel {
  show: boolean;
  className: any
}

export const AssetsPanel: FC<IAssetsPanel> = ({ show, className }) => {
  const data = [
    { idk: '12.03040834', value: '$300.45', idk2: 'NikiBar' },
    { idk: '12.03040834', value: '$300.45', idk2: 'NikiBar' },
    { idk: '12.03040834', value: '$300.45', idk2: 'NikiBar' },
    { idk: '12.03040834', value: '$300.45', idk2: 'NikiBar' },
    { idk: '12.03040834', value: '$300.45', idk2: 'NikiBar' },
    { idk: '12.03040834', value: '$300.45', idk2: 'NikiBar' }
  ]

  const assets = useAccount().activeAccount!.assets || [];

  return (
    <ul className={className}>
      {show ? (
        <PanelList
          data={data}
          activity={false}
          assets={true}
        />
      ) : (
        <p className="justify-center items-center text-sm text-brand-gray">
          You have no tokens or NFTs.
        </p>
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
