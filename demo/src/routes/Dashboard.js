import { useEffect, useState } from "react";
import { useSelector } from "react-redux";

import asset2 from "../images/asset2.svg";

export default function Dashboard() {
  const [assets, setAssets] = useState([]);
  const { balance, connectedAccount } = useSelector(
    (state) => state.connectedAccountData
  );

  useEffect(() => {
    connectedAccount && setAssets(connectedAccount.assets);
  }, [connectedAccount]);

  const RenderBalance = ({ balance }) => {
    const _balance = `${balance}`.split(".");
    return (
      <>
        {Intl.NumberFormat("en-US").format(_balance[0])}
        <span className="decimal">.{_balance[1]}</span> <em>SYS</em>
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
            <RenderBalance balance={balance} />
          </div>
        </div>
        <div className="assets">
          {assets.map((asset) => (
            <div className="asset" key={asset.assetGuid}>
              <img src={asset2} />
              <div className="balance">
                {asset.balance}
                {/*<span className="decimal">.866544444</span>*/}
              </div>
              <div className="symbol">{asset.symbol}</div>
              <div className="asset-id">Asset ID: {asset.assetGuid}</div>
              {/* <div className="nft-id">NFT ID: 4324234234242</div> */}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
