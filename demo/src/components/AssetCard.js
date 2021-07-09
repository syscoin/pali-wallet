import { memo } from "react";
import { useSelector } from "react-redux";

import assetLogo from "../images/asset.svg";
import assetLogo2 from "../images/asset2.svg";

function AssetCard({ asset }) {
  const controller = useSelector((state) => state.controller);

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

  const SPTCard = () => {
    return (
      <div className="asset" key={asset.assetGuid}>
        <img src={asset?.logoUrl || assetLogo2} alt="" />
        <div className="balance">
          <RenderBalance balance={asset.balance} decimals={asset.decimals} />
        </div>
        <div className="symbol">{asset.symbol}</div>
        <div className="asset-id">Asset ID: {asset.assetGuid}</div>
      </div>
    );
  };

  const NFTCard = () => {
    return (
      <div className="asset" key={asset.assetGuid}>
        <div className="nft-id">Parent NFT</div>
        <img src={assetLogo} alt="" />
        <div className="balance">
          <RenderBalance balance={asset.balance} decimals={asset.decimals} />
        </div>
        <div className="symbol">{asset.symbol}</div>
        <div className="nft-id">
          IPFS URL:{" "}
          <a
            href={asset.description}
            target="_blank"
            rel="noreferrer"
            title={asset.description}
          >
            {asset.description.substr(0, 10)}...
          </a>
        </div>
        <div className="asset-id">Asset ID: {asset.assetGuid}</div>
        {controller.isNFT(asset.assetGuid) && (
          <div className="nft-id">NFT ID: {asset.nftAssetID}</div>
        )}
      </div>
    );
  };

  return (
    <>
      {asset.description.startsWith("https://ipfs.io/ipfs/") ? (
        <NFTCard />
      ) : (
        <SPTCard />
      )}
    </>
  );
}

export default memo(AssetCard);
