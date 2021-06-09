import React, { useState, useEffect } from "react";
import { useSelector } from "react-redux";

const FormMintNFT = (props) => {
  const controller = useSelector((state) => state.controller);
  const [assetGuid, setAssetGuid] = useState("");
  const [receiver, setReceiver] = useState("");
  const [nfthash, setNfthash] = useState("");
  const [data, setData] = useState([]);

  useEffect(() => {
    (async () => {
      controller && setData(await controller.getUserMintedTokens());
    })();
  }, []);

  const handleMintNFT = async (event) => {
    event.preventDefault();

    await controller.handleIssueNFT(assetGuid, nfthash, receiver);

    event.target.reset();

    setAssetGuid(null);
  };

  return (
    <form onSubmit={handleMintNFT}>
      <fieldset>
        <legend>YOU ARE MINTING NFTS</legend>

        <div>
          <div className="input-group mb-3">
            <label htmlFor="assetGuid">AssetGuid:</label>

            <select
              id="assetGuid"
              name="assetGuid"
              className="custom-select"
              onBlur={(event) => setAssetGuid(event.target.value)}
            >
              <option>Choose...</option>

              {data.map((asset, index) => {
                return <option key={index}>{asset.assetGuid}</option>;
              })}
            </select>
          </div>

          <label htmlFor="amount">NFT Hash:</label>
          <input
            className="input"
            type="text"
            id="nfthash"
            name="nfthash"
            onBlur={(event) => setNfthash(event.target.value)}
            required
          />

          <label htmlFor="receiver">Receiver:</label>
          <input
            className="input"
            type="text"
            id="receiver"
            name="receiver"
            onBlur={(event) => setReceiver(event.target.value)}
            required
          />

          {/* <label htmlFor="rbf">RBF:</label>
          <input 
            id="rbf" 
            name="rbf" 
            type="checkbox" 
            className="switch"
            onChange={() => {
              setRbf(!rbf)
            }}
            checked={rbf}
          /> */}
        </div>
      </fieldset>

      <button
        className="button"
        type="submit"
        disabled={[nfthash, receiver, assetGuid].includes("")}
      >
        Mint
      </button>
    </form>
  );
};

export default FormMintNFT;
