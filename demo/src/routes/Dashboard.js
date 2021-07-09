import { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";

import AssetCard from "../components/AssetCard";

export default function Dashboard() {
  const [assets, setAssets] = useState([]);
  const { balance, connectedAccount } = useSelector(
    (state) => state.connectedAccountData
  );

  const assetCards = useMemo(() =>
    assets.map((asset) => <AssetCard key={asset.assetGuid} asset={asset} />)
  , [assets]);

  useEffect(() => {
    connectedAccount?.assets && setAssets(connectedAccount.assets);
  }, [connectedAccount]);

  const RenderBalance = ({ balance, decimals }) => {
    const _balance = `${
      !decimals ? balance : balance / Math.pow(10, decimals)
    }`.split(".");

    return (
      <>
        {Intl.NumberFormat("en").format(_balance[0])}
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
        <div className="assets">{assetCards}</div>
      </div>
    </section>
  );
}
