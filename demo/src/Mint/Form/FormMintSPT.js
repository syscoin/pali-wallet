import React, { useState, useEffect } from "react";

const FormMintSPT = (props) => {
  const [state, setState] = useState({
    amount: 0,
    fee: 0,
    description: '',
    rbf: false,
    assetGuid: ''
  });
  const {
    amount,
    fee,
    description,
    rbf,
    assetGuid
  } = state;

  const getUserMintedTokens = async () => {
    return await window.ConnectionsController.getUserMintedTokens()
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
              <option value={getUserMintedTokens}>{getUserMintedTokens}</option>
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

          <label htmlFor="description">Description:</label>
          <input 
            className="input" 
            type="text" 
            id="description" 
            name="description"
            onBlur={(event) => setState({
              ...state,
              description: event.target.value
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
       onClick={() => getUserMintedTokens()
      }
      >
       GET
      </button>

      <button
        className="button" 
        type="submit"
        disabled={
          !amount ||
          !fee ||
          !description ||
          !rbf ||
          !assetGuid
        }
      >
        Mint
      </button>
    </form>
  );
}

export default FormMintSPT;


