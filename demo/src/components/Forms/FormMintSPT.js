import React, { useState, useEffect } from "react";
import { useSelector } from "react-redux";

const FormMintSPT = (formCallback) => {
  const controller = useSelector((state) => state.controller);
  const [assetGuid, setAssetGuid] = useState("");
  const [receiver, setReceiver] = useState("");
  const [rbf, setRbf] = useState(false);
  const [amount, setAmount] = useState(0);
  const [tokens, setTokens] = useState([]);

  useEffect(() => {
    (async () => {
      controller && setTokens(await controller.getUserMintedTokens());
    })();
  }, []);

  const RenderAsset = () => {
    return tokens.map((asset, index) => {
      return (
        <option
          key={index}
          value={asset.assetGuid}
        >{`Symbol: ${asset.symbol} --- AssetGuid: ${asset.assetGuid}`}</option>
      );
    });
  };

  return (
    <form
      onSubmit={(event) =>
        formCallback.formCallback(event, amount, receiver, assetGuid)
      }
    >
      <fieldset>
        <legend>YOU ARE MINTING SPTS</legend>

        <div>
          {/* <Dropdown/> */}
          <div className="input-group mb-3">
            <label htmlFor="assetGuid">AssetGuid:</label>

            <select
              id="assetGuid"
              name="assetGuid"
              className="custom-select"
              onBlur={(event) => setAssetGuid(event.target.value)}
              required
            >
              <option>{assetGuid}</option>
              <RenderAsset />
            </select>
          </div>
          <label htmlFor="amount">Amount:</label>
          <input
            className="input"
            type="number"
            id="amount"
            name="amount"
            onBlur={(event) => setAmount(event.target.value)}
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
        disabled={!amount || !receiver || !assetGuid}
        onClick={() => console.log("assetguid selected", assetGuid)}
      >
        Mint
      </button>
    </form>
  );
};

export default FormMintSPT;
