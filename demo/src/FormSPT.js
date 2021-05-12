import React, { useState }from "react";

function FormSpt(props) {
  const [controller, setController] = useState();


  const getAssetGuid = async () => {
 await controller.getAssetGuid()
  } 
  return (
    <form onSubmit={props.formCallback}>

  <div className="property">YOU ARE MINTING SPTS
      <div>
<div class="input-group mb-3">
  <label for="custom-select">AssetGuid: </label>
  <select id="assetGuid" 
          name="assetGuid" 
          class="custom-select" >
    <option selected>Choose...</option>
    <option value={getAssetGuid}>{getAssetGuid}</option>
    <option value="2">Two</option>
    <option value="3">Three</option>
  </select>

</div>

          <label for="input">Amount:</label>
          <input 
          className="input" 
          type="text" 
          id="amount1" 
          name="amount1" 
          required>
          </input>

          {/* <label for="input">Receiver</label>
          <input 
          className="input" 
          type="text" 
          id="sysAddress" 
          name="sysAddress" 
          required>
          </input> */}

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


