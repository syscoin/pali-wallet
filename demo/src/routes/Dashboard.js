import { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";

import AssetCard from "../components/AssetCard";
import { getAllLogo } from "../utils/logoService";
import loaderImg from "../images/spinner.svg";

export default function Dashboard() {
  const [assets, setAssets] = useState([]);
  const { balance, connectedAccount } = useSelector(
    (state) => state.connectedAccountData
  );

  const assetCards = useMemo(() =>
    assets.map((asset) => <AssetCard key={asset.assetGuid} asset={asset} />)
  , [assets]);

  useEffect(() => {
    (async function () {
      try {
        if (connectedAccount?.assets) {
          const allAssets = connectedAccount.assets;
          const assetsIds = allAssets.map((a) => a.assetGuid);
          const images = await getAllLogo(assetsIds);

          const newAssets = allAssets.reduce((acc, cur) => {
            const logo = images.urls.find((i) => i[0] === cur.assetGuid);
            return logo
              ? (acc = [...acc, { ...cur, logoUrl: logo[1] }])
              : (acc = [...acc, cur]);
          }, []);

          setAssets(newAssets);
        }
      } catch (error) {
        setAssets(connectedAccount.assets);
      }
    })();
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
        {assets.length ? (
          <div className="assets">{assetCards}</div>
        ) : (
          <div
            style={{
              display: "flex",
              width: "100%",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img src={loaderImg} alt="" />
          </div>
        )}
      </div>
    </section>
  );
}
