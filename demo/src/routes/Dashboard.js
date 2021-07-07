import { useEffect, useState } from "react";
import { useSelector } from "react-redux";

import asset2 from "../images/asset2.svg";

export default function Dashboard() {
  const [assets, setAssets] = useState([]);
  const { isNFT } = useSelector((state) => state.controller);
  const { balance, connectedAccount } = useSelector(
    (state) => state.connectedAccountData
  );

  useEffect(() => {
    connectedAccount && setAssets(connectedAccount.assets);
  }, [connectedAccount]);

  const RenderBalance = ({ balance, decimals }) => {
    const _balance = `${
      !decimals ? balance : balance / Math.pow(10, decimals)
    }`.split(".");

    return (
      <>
        {Intl.NumberFormat("en" ).format(_balance[0])}
        <span className="decimal">{_balance[1] && `.${_balance[1]}`}</span>
      </>
    );
  };

  return (
    <section>
      <div className="inner">
        <h1>Dashboard</h1>
        <div className="holdings bottom-border">
          <h2>Holdings</h2>
          <div className="sysvalue">
            <RenderBalance balance={balance} /> <em>SYS</em>
          </div>
        </div>
        <div className="assets">
          {assets.map((asset) => (
            <div className="asset" key={asset.assetGuid}>
              <img src={asset2} />
              <div className="balance">
                <RenderBalance
                  balance={asset.balance}
                  decimals={asset.decimals}
                />
              </div>
              <div className="symbol">{asset.symbol}</div>
              <div className="asset-id">Asset ID: {asset.assetGuid}</div>
              {isNFT(asset.assetGuid) && (
                <div className="nft-id">NFT ID: {asset.nftAssetID}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
