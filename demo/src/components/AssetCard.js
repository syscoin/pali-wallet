import { useState, useEffect } from "react";
import { useSelector } from "react-redux";


import asset from "../images/asset.svg";
import asset2 from "../images/asset2.svg";

export default function AssetCard({ asset }) {
  const controller = useSelector((state) => state.controller);
  const [ipfsUrl, setIpfsUrl] = useState(null);

  useEffect(() => {
    (async function() {
      const dataAsset = await controller.getDataAsset(asset.assetGuid);
      const _ipfsUrl = dataAsset?.pubData.desc ? atob(dataAsset.pubData.desc) : null;

      _ipfsUrl && setIpfsUrl(_ipfsUrl);
    })()
  }, [])

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
    <a href={ipfsUrl} className="asset" key={asset.assetGuid}>
      <img src={asset2} alt="" />
      <div className="balance">
        <RenderBalance balance={asset.balance} decimals={asset.decimals} />
      </div>
      <div className="symbol">{asset.symbol}</div>
      <div className="asset-id">Asset ID: {asset.assetGuid}</div>
      {/* // se tiver esse campo child nft e se for ipfs o link na descricao e vai se chamar parent nft */}
      {controller.isNFT(asset.assetGuid) && (
        <>
          <div className="nft-id">NFT ID: {asset.nftAssetID}</div>
          <div className="nft-id">NFT ID: {asset.description}</div>
        </>
      )}
    </a>
  );
}
