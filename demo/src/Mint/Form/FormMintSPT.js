import React, { useState, useEffect } from "react";

const FormMintSPT = (props) => {
  const [state, setState] = useState({
    amount: 0,
    fee: 0,
    receiver: '',
    rbf: false,
    assetGuid: ''
  });
  const {
    amount,
    fee,
    receiver,
    rbf,
    assetGuid
  } = state;
  const [tokenMinted, setTokenMinted] = useState("");

  const getUserMintedTokens = async () => {
    console.log('get user minted tokens')

    await window.ConnectionsController.getUserMintedTokens();

    console.log('aafter function')
  }

  return (
    <form onSubmit={(event) => props.formCallback(event, state)}>
      <fieldset>
        <legend>YOU ARE MINTING SPTS</legend>

        <div>
          <div className="input-group mb-3">
            <label htmlFor="assetGuid">AssetGuid:</label>

            <select
              id="assetGuid" 
              name="assetGuid" 
              className="custom-select"
              onChange={(event) => setState({
                ...state,
                assetGuid: Number(event.target.value)
              })}
            >
              <option>Choose...</option>
              <option value="2">Two</option>
              <option value="3">Three</option>
            </select>
          </div>

          <label htmlFor="amount">Amount:</label>
          <input 
            className="input" 
            type="number" 
            id="amount" 
            name="amount" 
            onBlur={(event) => setState({
              ...state,
              amount: Number(event.target.value)
            })}
            required
          />

          <label htmlFor="receiver">Receiver:</label>
          <input 
            className="input" 
            type="text" 
            id="receiver" 
            name="receiver"
            onBlur={(event) => setState({
              ...state,
              receiver: event.target.value
            })}
            required
          />

          <label htmlFor="fee">Fee:</label>
          <input 
            className="input" 
            type="number" 
            id="fee" 
            name="fee" 
            onBlur={(event) => setState({
              ...state,
              fee: Number(event.target.value)
            })}
            required
          />
              
          <label htmlFor="rbf">RBF:</label>
          <input 
            id="rbf" 
            name="rbf" 
            type="checkbox" 
            className="switch"
            onChange={(event) => setState({
              ...state,
              rbf: event.target.value
            })}
          />
        </div>
      </fieldset>

      <button
        className="button"
        type="button"
        onClick={() => getUserMintedTokens()}
      >
       GET
      </button>

      {/* <button
        className="button" 
        type="submit"
        disabled={
          !amount ||
          !fee ||
          !receiver ||
          !rbf ||
          !assetGuid
        }
      >
        Mint
      </button> */}
    </form>
  );
}

export default FormMintSPT;


