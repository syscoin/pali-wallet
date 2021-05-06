import React from "react";

 function FormSpt(props) {

  //   alert(`Submitting Asset Guid: "${assetGuid}", Value: "${value}", Sys Receiveing Address: ${sysAddress} `)}
  return (
    <form onSubmit={props.formCallback}>

  <div className="property">YOU ARE MINTING SPTS
      <div>
            <label for="input">AssetGuid:</label>
          <input className="input" type="text" id="assetGuid" name="assetGuid" required></input>
           <label for="Student">Amount:</label>
          <input className="input" type="text" id="amount" name="amount" required></input>
          <label for="input">Fee:</label>
           <input className="input" type="text" id="fee" name="fee" required
            ></input>   <label for="input">Sys address:</label>
             <input className="input" type="text" id="receiver" name="receiver" required
            ></input>
              <label for="input">RBF:</label>
              <input id="rbf" name="rbf" type="checkbox" class="switchh"/>
        </div> <input className="button" type="submit" value="MINT!"/></div>
           
    </form>
  );
}
  export default FormSpt;
