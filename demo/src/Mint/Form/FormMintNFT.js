import React, { useState } from "react";
import ReactTooltip from 'react-tooltip';
import Switch from "react-switch";
import HelpOutlineIcon from '@material-ui/icons/HelpOutline';
import { setFormState } from "../../helpers";

const FormMintNFT = (props) => {
  const [state, setState] = useState({
    nftName: '',
    description: '',
    maxShares: 0,
    editions: 0,
    royalites: 0,
    property1: '',
    property2: '',
    property3: '',
    attribute1: '',
    attribute2: '',
    attribute3: ''
  });

  const {
    nftName,
    maxShares,
    description,
    editions,
    royalites
  } = state;

  return (
    <form onSubmit={(event) => props.formCallback(event, state)}>
      <div id="checkbox">
        <input
          type="text"
          id="nftName"
          name="nftName"
          placeholder="NFT Name"
          onBlur={(event) => setFormState(event, state, 'nftName', setState)}
        />

        <input
          type="text"
          id="description"
          name="description"
          placeholder="Description"
          onBlur={(event) => setFormState(event, state, 'description', setState)}
        />

        <input
          type="number"
          id="editions"
          name="editions"
          placeholder="Editions"
          onBlur={(event) => setFormState(event, state, 'editions', setState)}
        />
      </div>

      <div id="checkbox">
        <input
          type="number"
          placeholder="Royalites %"
          onBlur={(event) => setFormState(event, state, 'royalites', setState)}
        />

        <div>
          <p>Share?</p>

          <input
            id="share"
            name="share"
            type="checkbox"
          />
          <label htmlFor="share">Yes</label>

          <input
            type="text"
            id="maxShares"
            name="maxShares"
            placeholder="Max. share"
            onBlur={(event) => setFormState(event, state, 'maxShares', setState)}
          />
        </div>
      </div> 

      <div className="collection">
        <div>
          <h2>Chose collection:</h2>

          <p className="button">Create</p>
          <p className="button">SYS</p>

          <div className="info_property">
            <div
              className="info_property"
              style={{ margin: "2rem 0" }}
            >
              <div
                style={{ display: "flex", alignItems: "center" }}
              >
                <p
                  style={{ margin: "0", fontSize: '0.9rem' }}
                >
                  Info Property
                </p>

                <HelpOutlineIcon
                  style={{ width: "0.9rem", height: "0.9rem" }}
                  data-tip data-for="prop_info"
                />
              </div>

              <ReactTooltip
                id="prop_info"
                getContent={()=>
                  <ul style={{ listStyle: "none", margin: "0", padding: "0" }}>
                    <li style={{ margin: "0.5rem" }}>
                      <span>
                        You can create properties and fill each property with an atribute <br/> this is optional
                      </span>
                    </li>
                  </ul>
                }
                effect='solid'
                delayHide={100}
                delayShow={100}
                delayUpdate={500}
                place={'right'}
                border={true}
                type={'info'}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="property">
        <input
          type="text"
          placeholder="Property 1"
          onBlur={(event) => setFormState(event, state, 'property1', setState)}
        />

        <input
          type="text"
          placeholder="Property 2"
          onBlur={(event) => setFormState(event, state, 'property2', setState)}
        />

        <input
          type="text"
          placeholder="Property 3"
          onBlur={(event) => setFormState(event, state, 'property3', setState)}
        />

        <input
          type="text"
          placeholder="Atributte 1"
          onBlur={(event) => setFormState(event, state, 'attribute1', setState)}
        />

        <input
          type="text"
          placeholder="Atributte 2"
          onBlur={(event) => setFormState(event, state, 'attribute2', setState)}
        />

        <input
          type="text"
          placeholder="Atributte 3"
          onBlur={(event) => setFormState(event, state, 'attribute3', setState)}
        />
      </div>

      <button
        className="button"
        type="submit"
        disabled={
          !nftName ||
          !description ||
          !maxShares ||
          !editions ||
          !royalites
        }
      >
        Mint
      </button>
    </form>
  );
}
  export default FormMintNFT;