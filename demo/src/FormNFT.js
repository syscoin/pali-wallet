import React, { useState } from "react";
import ReactTooltip from 'react-tooltip';
import Switch from "react-switch";
import HelpOutlineIcon from '@material-ui/icons/HelpOutline';

const FormNFT = (props) => {
  const [nftName, setNftName] = useState("");
  const [description, setDescription] = useState("");
  const [editions, setEditions] = useState("");
  const [royalites, setRoyalites] = useState("");
  const [maxShares, setMaxShares] = useState("");
  const [propertyParent1, setProperty1] = useState("");
  const [propertyAtributte1, setAtributte1] = useState("");
  const [propertyParent2, setProperty2] = useState("");
  const [propertyAtributte2, setAtributte2] = useState("");
  const [propertyParent3, setProperty3] = useState("");
  const [propertyAtributte3, setAtributte3] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
//v
    alert(`Submitting NFT Name: "${nftName}", Description: "${description}", MaxShares: ${maxShares}, Editions: ${editions}, Royalites: ${royalites}%, Property 1: ${propertyParent1}, Atributte 1: ${propertyAtributte1}, Property 2: ${propertyParent2}, Atributte 2: ${propertyAtributte2}, Property 3: ${propertyParent3}, Atributte 3: ${propertyAtributte3} `)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div id="checkbox">
        <input
          type="text"
          id="nftName"
          name="nftName"
          placeholder="NFT Name"
          value={nftName}
          onChange={(event) =>  setNftName(event.target.value)}
        />

        <input
          type="text"
          id="description"
          name="description"
          placeholder="Description"
          value={description}
          onChange={(event) =>  setDescription(event.target.value)}
        />

        <input
          type="text"
          id="editions"
          name="editions"
          placeholder="Editions"
          value={editions}
          onChange={(event) =>  setEditions(event.target.value)}
        />
      </div>

      <div id="checkbox">
        <input
          type="text"
          placeholder="Royalites %"
          value={royalites}
          onChange={(event) =>  setRoyalites(event.target.value)}
        />

        <label> Share?
          <input type="checkbox"/> Yes

          <input
            type="text"
            id="maxShares"
            name="maxShares"
            placeholder="Max. share"
            value={maxShares}
            onChange={(event) =>  setMaxShares(event.target.value)}
          />
        </label>
      </div> 

      <div className="collection">
        <label>Chose collection:
          <a className="button" >Create</a>
          <a className="button" onClick={console.log(nftName)} >SYS</a>
          <div className="info_property">
            <div className="info_property" style={{ margin: "2rem 0" }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <label style={{ margin: "0", fontSize: '0.9rem' }}> Info Property</label>

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
        </label>
      </div>

      <div className="property">
        <input
          type="text"
          placeholder="Property 1"
          value={propertyParent1}
          onChange={(event) => setProperty1(event.target.value)}
        />

        <input
          type="text"
          placeholder="Property 2"
          value={propertyParent2}
          onChange={(event) => setProperty2(event.target.value)}
        />

        <input
          type="text"
          placeholder="Property 3"
          value={propertyParent3}
          onChange={(event) => setProperty3(event.target.value)}
        />

        <input
          type="text"
          placeholder="Atributte 1"
          value={propertyAtributte1}
          onChange={(event) =>setAtributte1(event.target.value)}
        />

        <input
          type="text"
          placeholder="Atributte 2"
          value={propertyAtributte2}
          onChange={(event) => setAtributte2(event.target.value)}
        />

        <input
          type="text"
          placeholder="Atributte 3"
          value={propertyAtributte3}
          onChange={(event) => setAtributte3(event.target.value)}
        />
      </div>

      <input
        className="button"
        type="submit"
        value="MINT"
      />   
    </form>
  );
}
  export default FormNFT;