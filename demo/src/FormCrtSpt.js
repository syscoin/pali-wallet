import React from "react";

function FormCrtSpt(props) {

  return (
    <form onSubmit={props.formCallback}>

      <div className="property">YOU ARE CREATING SPTS
      <div>
          <label for="input">Precision:</label>
          <input className="input" type="text" id="precision" name="precision" required
           ></input>
          <label for="input">Max. Supply:</label>
          <input className="input" type="text" id="maxSupply" name="maxSupply" required
            ></input>
          <label for="input">Description</label>
          <input className="input" type="text" id="description" name="description" required
            ></input>
          <label for="input">Symbol:</label>
          <input className="input" type="text" id="symbol" name="symbol" required
            ></input>   <label for="input">Fee:</label>
           <input className="input" type="text" id="fee" name="fee" required
            ></input>   <label for="input">Sys address:</label>
             <input className="input" type="text" id="sysAddress" name="sysAddress" required
            ></input>
              <label for="input">RBF:</label>
              <input id="rbf" name="rbf" type="checkbox" class="switchh"/>

        </div> <input className="button" type="submit" value="CREATE!" /></div>

    </form>
  );
}
export default FormCrtSpt;
