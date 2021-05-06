import React, { useState } from "react";

 function FormCollect(props) {
 const [collectName, setCollectName] = useState("");
 const [description, setDescription] = useState("");
 const [shortUrl, setShortUrl] = useState("");
 const [symbol, setSymbol] = useState("");
 const [propertyParent1, setProperty1] = useState("");
 const [propertyAtributte1, setAtributte1] = useState("");
 const [propertyParent2, setProperty2] = useState("");
 const [propertyAtributte2, setAtributte2] = useState("");
 const [propertyParent3, setProperty3] = useState("");
 const [propertyAtributte3, setAtributte3] = useState("");

  const handleSubmit = (evt) => {
      evt.preventDefault();
      alert(`Submitting Collection Name: "${collectName}", Description: "${description}", Short Url: ${shortUrl} `)}
  return (
    <form onSubmit={handleSubmit}>

  <div className="property">YOU ARE CREATING COLLECTION
      <div>
            <label for="input">AssetGuid:</label>
          <input className="input" type="text" id="name" name="lname" value={collectName}
          onChange={e =>  setCollectName(e.target.value)}></input>
           <label for="Student">Value:</label>
          <input className="input" type="text" id="lname" name="lname" value={description}
          onChange={e =>  setDescription(e.target.value)}></input>
           <label for="Student">Sys address:</label>
           <input className="input" type="text" id="lname" name="lname"  value={shortUrl}
          onChange={e =>  setShortUrl(e.target.value)}></input>
              <label type="file" for="arquivo">UPLOAD SYMBOL</label>
          <input type="file" name="arquivo" id="arquivo" value={symbol} onChange={e =>  setSymbol(e.target.value)}/> 
        </div> </div>
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
          onChange={e =>  setAtributte3(e.target.value)}></input><input className="button" type="submit" value="CREATE"/>
          </div>
           
    </form>
  );
}
  export default FormCollect;

