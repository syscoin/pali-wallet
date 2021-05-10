import React, { useState }from "react";

function FormSpt(props) {
  const [assetGuid, setAssetGuid] = useState("");
  const [amount1, setAmount1] = useState("");
  const [sysAddress, setSysAddress] = useState("");
  const [description, setDescription] = useState("");
  const [fee1, setFee1] = useState("");
  const [rbf, setRbf] = useState("");
  //   alert(`Submitting Asset Guid: "${assetGuid}", Value: "${value}", Sys Receiveing Address: ${sysAddress} `)//v}
  return (
    <form onSubmit={props.formCallback}>

  <div className="property">YOU ARE MINTING SPTS
      <div>
      {/* <label for="input">AssetGuid:</label>
          <input 
          className="input" 
          type="text" 
          id="lname" 
          name="lname"  
          value={assetGuid}
          onChange={e =>  setAssetGuid(e.target.value)} required></input>
      <label for="input">Amount:</label>
          <input className="input" 
          type="text" 
          id="amount" 
          name="amount"
          value={amount1} required
          onChange={e =>  setAmount1(e.target.value)}></input>
      <label for="Student">Sys address:</label>
           <input 
           className="input" 
           type="text"  
           id="receiver" 
           name="receiver" 
           required value={sysAddress}
           onChange={e =>  setSysAddress(e.target.value)}></input>  
       <label for="input">Description:</label>
          <input 
          className="input" 
          type="text" 
          id="description" 
          name="description" 
          required value={description}
          onChange={e =>  setDescription(e.target.value)}></input>
       <label for="input">Fee:</label>
          <input className="input"
            type="text"
            id="fee" 
            name="fee" 
            required 
            value={fee1}
            onChange={e =>  setFee1(e.target.value)}></input>
        <label for="input">RBF:</label>
           <input 
            id="rbf" 
            name="rbf" 
            type="checkbox" 
            class="switchh" 
            value={rbf}
            onClick={e =>  setRbf(e.target.value)}/> */}

<label for="input">AssetGuid:</label>
          <input 
          className="input" 
          type="text" 
          id="assetGuid" 
          name="assetGuid" 
          required>
          </input>

          <label for="input">Amount:</label>
          <input 
          className="input" 
          type="text" 
          id="amount1" 
          name="amount1" 
          required>
          </input>

          <label for="input">Receiver</label>
          <input 
          className="input" 
          type="text" 
          id="sysAddress" 
          name="sysAddress" 
          required>
          </input>

          <label for="input">Description:</label>
          <input 
          className="input" 
          type="text" 
          id="description" 
          name="description" 
          required>
          </input>   

            <label for="input">Fee:</label>
            <input 
            className="input" 
            type="text" 
            id="fee1" 
            name="fee1" 
            required>
            </input>
              
            <label for="input">RBF:</label>
            <input 
            id="rbf" 
            name="rbf" 
            type="checkbox" 
            class="switchh"/>
        
        </div> 
        <input 
        className="button" 
        type="submit" 
        value="MINT!"/></div>  
    </form>
  );
}
  export default FormSpt;


