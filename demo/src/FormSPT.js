import React, { useState } from "react";

const FormSPT = (props) => {
 const [assetGuid, setAssetGuid] = useState("");
 const [value, setValue] = useState("");
 const [sysAddress, setSysAddress] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();

    alert(`Submitting Asset Guid: "${assetGuid}", Value: "${value}", Sys Receiveing Address: ${sysAddress} `)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="property">YOU ARE MINTING SPTS
        <div>
          <label for="assetGuid">AssetGuid:</label>
          <input
            className="input"
            type="text"
            id="assetGuid"
            name="assetGuid"
            placeholder="Property 1"
            value={assetGuid}
            onChange={(event) => setAssetGuid(event.target.value)}
          />
           
          <label for="value">Value:</label>
          <input
            className="input"
            type="text"
            id="value"
            name="value"
            placeholder="Property 2"
            value={value}
            onChange={(event) =>  setValue(event.target.value)}
          />
           
          <label for="address">Sys address:</label>
          <input
            className="input"
            type="text"
            id="address"
            name="address"
            placeholder="Property 2"
            value={sysAddress}
            onChange={(event) =>  setSysAddress(event.target.value)}
          />
        </div>
        
        <input
          className="button"
          type="submit"
          value="MINT!"
        />
      </div>  
    </form>
  );
}

export default FormSPT;
