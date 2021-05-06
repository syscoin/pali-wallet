import React, { useState } from "react";

 function FormSpt(props) {
 const [assetGuid, setAssetGuid] = useState("");
 const [value, setValue] = useState("");
 const [sysAddress, setSysAddress] = useState("");

  const handleSubmit = (evt) => {
      evt.preventDefault();
      alert(`Submitting Asset Guid: "${assetGuid}", Value: "${value}", Sys Receiveing Address: ${sysAddress} `)}
  return (
    <form onSubmit={handleSubmit}>

  <div className="property">YOU ARE MINTING SPTS
      <div>
            <label for="input">AssetGuid:</label>
          <input className="input" type="text" id="lname" name="lname" placeholder="Property 1" value={assetGuid}
          onChange={e =>  setAssetGuid(e.target.value)}></input>
           <label for="Student">Value:</label>
          <input className="input" type="text" id="lname" name="lname" placeholder="Property 2" value={value}
          onChange={e =>  setValue(e.target.value)}></input>
           <label for="Student">Sys address:</label>
           <input className="input" type="text" id="lname" name="lname" placeholder="Property 2" value={sysAddress}
          onChange={e =>  setSysAddress(e.target.value)}></input>
        </div> <input className="button" type="submit" value="MINT!"/></div>
           
    </form>
  );
}
  export default FormSpt;
