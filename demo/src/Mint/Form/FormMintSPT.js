import React, { useState, useEffect } from "react";
import Dropdown from "./DropAsset"
const FormMintSPT = (props) => {
  const [assetGuid, setAssetGuid] = useState('');
  const [receiver, setReceiver] = useState('');
  const [rbf, setRbf] = useState(false);
  const [amount, setAmount] = useState(0);
  
 
  return (
    <form
      onSubmit={(event) => props.formCallback(
        event,
        amount,
        0.0001, // fee - wallet
        receiver,
        rbf,
        assetGuid
      )}
    >
      <fieldset>
        <legend>YOU ARE MINTING SPTS</legend>

        <div>
          <Dropdown/>

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

          <label htmlFor="rbf">RBF:</label>
          <input 
            id="rbf" 
            name="rbf" 
            type="checkbox" 
            className="switch"
            onChange={() => {
              setRbf(!rbf)
            }}
            checked={rbf}
          />
        </div>
      </fieldset>

      <button
        className="button"
        type="button"
      >
       GET
      </button>

      <button
        className="button" 
        type="submit"
        disabled={
          !amount ||
          !receiver ||
          !assetGuid
        }
      >
        Mint
      </button>
    </form>
  );
}

export default FormMintSPT;


