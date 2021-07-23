import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { AnimatedList } from "react-animated-list";

import useFetch from "../hooks/useFetch";
import AssetCard from "../components/AssetCard";
import loaderImg from "../images/spinner.svg";
import paliLogo from "../images/pali_logo.svg";

export default function Dashboard() {
  const [accountAssets, setAccountAssets] = useState([]);
  const [page, setPage] = useState(1);
  const { isLoading, assets, hasMore } = useFetch(accountAssets, page);
  const loaderObserver = useRef();
  const { balance, connectedAccount } = useSelector(
    (state) => state.connectedAccountData
  );

  const loaderElementRef = useCallback((element) => {
    if(isLoading) return;

    if(loaderObserver.current) loaderObserver.current.disconnect();

    loaderObserver.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        setPage(prev => prev + 1);
      }
    });

    if (element) loaderObserver.current.observe(element);
  }, [isLoading, hasMore]);

  const assetCards = useMemo(
    () =>
      assets.map((asset) => <AssetCard key={asset.assetGuid} asset={asset} />),
    [assets]
  );

  useEffect(() => {
    if (connectedAccount?.assets) {
      const sortedAssets = [...new Set([...connectedAccount.assets])];
      if (sortedAssets.length !== accountAssets.length) {
        setAccountAssets(sortedAssets);
        setPage(1);

        return;
      }

      if (!sortedAssets.length) {
        setAccountAssets([]);
        return;
      }

      if (JSON.stringify(sortedAssets) === JSON.stringify(accountAssets)) {
        return;
      }

      setAccountAssets(sortedAssets);
    }
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
          <div className="assets">
            <AnimatedList animation="grow">{assetCards}</AnimatedList>
            <div
              className="invisible-asset"
              key="observer"
              ref={loaderElementRef}
            ></div>
            {isLoading && (
              <img className="loader" src={loaderImg} alt="" />
            )}
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              width: "100%",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {!isLoading && !assets.length ? (
              <img src={paliLogo} alt="" width="200px" />
            ) : (
              <img src={loaderImg} alt="" width="70px" />
            )}
          </div>
        )}
      </div>
    </section>
  );
}
