import React, { useState } from "react";

 function Formi(props) {
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

  
  const handleSubmit = (evt) => {
      evt.preventDefault();
      alert(`Submitting NFT Name: "${nftName}", Description: "${description}", MaxShares: ${maxShares}, Editions: ${editions}, Royalites: ${royalites}%, Property 1: ${propertyParent1}, Atributte 1: ${propertyAtributte1}, Property 2: ${propertyParent2}, Atributte 2: ${propertyAtributte2}, Property 3: ${propertyParent3}, Atributte 3: ${propertyAtributte3} `)}
  return (
    <form onSubmit={handleSubmit}>
      <div id="checkbox">
  <input type="text" id="fname" name="fname" placeholder="NFT Name" value={nftName}
          onChange={e =>  setNftName(e.target.value)}  ></input>
  <input type="text" id="lname" name="lname" placeholder="Description" value={description}
          onChange={e =>  setDescription(e.target.value)}></input>
   <input type="text" id="lname" name="lname" placeholder="Editions" value={editions}
          onChange={e =>  setEditions(e.target.value)}></input>
      </div>
  <div id="checkbox"> <input type="text"  placeholder="Royalites %" value={royalites}
          onChange={e =>  setRoyalites(e.target.value)}/>
          <label> Share?
              <input type="checkbox"/> Yes     
          <input type="text" id="lname" name="lname" placeholder="Max. share" value={maxShares}
          onChange={e =>  setMaxShares(e.target.value)}></input></label>
      </div> 
  <div className="collection">
  <label>Chose collection:
  <a class="button" >Create</a>
  <a class="button" onClick={console.log(nftName)} >SYS</a>
  </label>
  </div>
  <div className="property">
          <input type="text" id="lname" name="lname" placeholder="Property 1" value={propertyParent1}
          onChange={e =>  setProperty1(e.target.value)}></input>
          <input type="text" id="lname" name="lname" placeholder="Property 2" value={propertyParent2}
          onChange={e =>  setProperty2(e.target.value)}></input>
          <input type="text" id="lname" name="lname" placeholder="Property 3" value={propertyParent3}
          onChange={e =>  setProperty3(e.target.value)}></input>
          <input type="text" id="lname" name="lname" placeholder="Atributte 1" value={propertyAtributte1}
          onChange={e => setAtributte1(e.target.value)}></input>
          <input type="text" id="lname" name="lname" placeholder="Atributte 2" value={propertyAtributte2}
          onChange={e =>  setAtributte2(e.target.value)}></input>
          <input type="text" id="lname" name="lname" placeholder="Atributte 3" value={propertyAtributte3}
          onChange={e =>  setAtributte3(e.target.value)}></input>
          </div> <input className="button" type="submit" value="Submit"/>
    </form>
  );
}
  export default Formi;
