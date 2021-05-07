import React, { useState } from "react";

const FormCreateSPT = (props) => {
  const [precision, setPrecision] = useState("");
  const [maxSupply, setMaxSupply] = useState("");
  const [description, setDescription] = useState("")
  const [sysAddress, setSysAddress] = useState("");
  const [symbol, setSymbol] = useState("");

  // const handleSubmit = (event) => {
  //   event.preventDefault();

  //   alert(`Submitting Precision: ${precision}, Max Supply: "${maxSupply}", Sys Receiveing Address: ${sysAddress}, Description: ${description}, Symbol:${symbol} `)
  // }

  return (
    <form onSubmit={props.formCallback}>
      <div className="property">YOU ARE CREATING SPTS
        <div>
          <label for="precision">Precision:</label>
          <input
            className="input"
            type="text"
            id="precision"
            name="precision"
            value={precision}
            onChange={(event) => setPrecision(event.target.value)}
          />

          <label for="maxSupply">Max. Supply:</label>
          <input
            className="input"
            type="text"
            id="maxSupply"
            name="maxSupply"
            value={maxSupply}
            onChange={(event) => setMaxSupply(event.target.value)}
          />

          <label for="description">Description</label>
          <input
            className="input"
            type="text"
            id="description"
            name="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />

          <label for="address">Sys address:</label>
          <input 
            className="input"
            type="text"
            id="address"
            name="address"
            value={sysAddress}
            onChange={(event) => setSysAddress(event.target.value)}
          />

          <label
            for="symbol"
          >
            UPLOAD SYMBOL
          </label>
          <input
            type="file"
            name="symbol" 
            id="symbol"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
          />
        </div>

        <input
          className="button"
          type="submit"
          value="CREATE"
        />
      </div>

    </form>
  );
}
export default FormCreateSPT;
