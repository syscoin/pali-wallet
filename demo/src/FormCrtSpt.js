import React, { useState } from "react";

function FormCrtSpt(props) {
  const [precision, setPrecision] = useState("");
  const [maxSupply, setMaxSupply] = useState("");
  const [description, setDescription] = useState("")
  const [sysAddress, setSysAddress] = useState("");
  const [symbol, setSymbol] = useState("");

  // const handleSubmit = (evt) => {
  //     evt.preventDefault();
  //     alert(`Submitting Precision: ${precision}, Max Supply: "${maxSupply}", Sys Receiveing Address: ${sysAddress}, Description: ${description}, Symbol:${symbol} `)}
  return (
    <form onSubmit={props.formCallback}>

      <div className="property">YOU ARE CREATING SPTS
      <div>
          <label for="input">Precision:</label>
          <input className="input" type="text" id="lname" name="lname" value={precision}
            onChange={e => setPrecision(e.target.value)}></input>
          <label for="Student">Max. Supply:</label>
          <input className="input" type="text" id="lname" name="lname" value={maxSupply}
            onChange={e => setMaxSupply(e.target.value)}></input>
          <label for="Student">Description</label>
          <input className="input" type="text" id="lname" name="lname" value={description}
            onChange={e => setDescription(e.target.value)}></input>
          <label for="Student">Sys address:</label>
          <input className="input" type="text" id="lname" name="lname" value={sysAddress}
            onChange={e => setSysAddress(e.target.value)}></input>
          <label type="file" for="arquivo">UPLOAD SYMBOL</label>
          <input type="file" name="arquivo" id="arquivo" value={symbol} onChange={e => setSymbol(e.target.value)} />
        </div> <input className="button" type="submit" value="CREATE" /></div>

    </form>
  );
}
export default FormCrtSpt;
