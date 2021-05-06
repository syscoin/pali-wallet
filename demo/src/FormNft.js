import React, { useState } from "react";
import ReactTooltip from 'react-tooltip';
import Switch from "react-switch";
import HelpOutlineIcon from '@material-ui/icons/HelpOutline';

 function Formi(props) {

    //  alert(`Submitting NFT Name: "${nftName}", Description: "${description}", MaxShares: ${maxShares}, Editions: ${editions}, Royalites: ${royalites}%, Property 1: ${propertyParent1}, Atributte 1: ${propertyAtributte1}, Property 2: ${propertyParent2}, Atributte 2: ${propertyAtributte2}, Property 3: ${propertyParent3}, Atributte 3: ${propertyAtributte3} `)}
  return (
    <form onSubmit={props.formCallback}>
      <div id="checkbox">
  <input type="text" id="nftName" name="nftName" placeholder="NFT Name" required ></input>
  <input type="text" id="description" name="description" placeholder="Description" required></input>
   <input type="text" id="editions" name="editions" placeholder="Editions" required></input>
      </div>
  <div id="royalites"> <input type="royalites"  placeholder="Royalites %" required />
          <label> Share? 
          <input id="share" name="share" placeholder=""type="checkbox" class="switch"/> Yes     
          <input type="text" id="maxShares" name="maxShares" placeholder="Max. share" required></input></label>
      </div> 
  <div className="collection">
  <label>Chose collection:
  <a class="button" >Create</a>
  <a class="button" >SYS</a>
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

                      {/* <li style={{ margin: "0.5rem" }}>
                        to know more: <br/>
                        <a href="https://syscoin.org/news/what-is-z-dag" target="_blank">
                          what is Z-DAG?
                        </a>
                      </li> */}
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
          <input type="text" id="propertyParent1" name="propertyParent1" placeholder="Property 1" 
          ></input>
          <input type="text" id="propertyParent2" name="propertyParent2" placeholder="Property 2" 
          ></input>
          <input type="text" id="propertyParent3" name="propertyParent3" placeholder="Property 3" v
          ></input>
          <input type="text" id="propertyAtributte1" name="propertyAtributte1" placeholder="Atributte 1" 
          ></input>
          <input type="text" id="propertyAtributte2" name="propertyAtributte2" placeholder="Atributte 2" 
          ></input>
          <input type="text" id="propertyAtributte3" name="propertyAtributte3" placeholder="Atributte 3" 
          ></input>   </div>   <input className="button" type="submit"  value="MINT!"  />     
    </form>
  );
}
  export default Formi;