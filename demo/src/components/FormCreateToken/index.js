import React, { useState } from "react";
import { setFormState } from "../../helpers";

const FormCreateToken = (props) => {
  const [state, setState] = useState({
    precision: 0,
    maxSupply: 0,
    description: '',
    symbol: '',
    fee: 0,
    sysAddress: '',
    rbf: false
  });

  const {
    precision,
    maxSupply,
    description,
    symbol,
    fee,
    sysAddress,
    rbf
  } = state;

  return (
    <form onSubmit={(event) => props.formCallback(event, state)}>
      <div className="property">
        <h2>You are creating {props.token}</h2>
        
        <div>
          <label htmlFor="precision">Precision:</label>
          <input 
            className="input" 
            type="text" 
            id="precision" 
            name="precision"
            onBlur={(event) => setFormState(event, state, 'precision', setState)}
            required
          />

          <label htmlFor="maxSupply">Max. Supply:</label>
          <input 
            className="input" 
            type="text" 
            id="maxSupply" 
            name="maxSupply"
            onBlur={(event) => setFormState(event, state, 'maxSupply', setState)}
            required
          />

          <label htmlFor="description">Description</label>
          <input 
            className="input" 
            type="text" 
            id="description" 
            name="description" 
            onBlur={(event) => setFormState(event, state, 'description', setState)}
            required
          />

          <label htmlFor="symbol">Symbol:</label>
          <input 
            className="input" 
            type="text" 
            id="symbol" 
            name="symbol"
            onBlur={(event) => setFormState(event, state, 'symbol', setState)}
            required
          />  

          <label htmlFor="fee">Fee:</label>
          <input 
            className="input" 
            type="text" 
            id="fee" 
            name="fee"
            onBlur={(event) => setFormState(event, state, 'fee', setState)}
            required
          /> 
              
          <label htmlFor="sysAddress">Sys address:</label>
          <input 
            className="input" 
            type="text" 
            id="sysAddress" 
            name="sysAddress" 
            onBlur={(event) => setFormState(event, state, 'sysAddress', setState)}
            required
          />
                
          <label htmlFor="rbf">RBF:</label>
          <input 
            id="rbf" 
            name="rbf" 
            type="checkbox"
            className="switch"
            onChange={(event) => setFormState(event, state, 'rbf', setState)}
          />
        </div> 
        
        <button 
          className="button" 
          type="submit" 
          disabled={
            !precision ||
            !maxSupply ||
            !description ||
            !symbol ||
            !fee ||
            !sysAddress ||
            !rbf
          }
        >
          Create
        </button>
      </div>
    </form>
  );
}

export default FormCreateToken;
