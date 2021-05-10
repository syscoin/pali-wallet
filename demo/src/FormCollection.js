import React, { useState } from "react";

const FormCollection = (props) => {
  const [collectionName, setCollectionName] = useState("");
  const [description, setDescription] = useState("");
  const [shortUrl, setShortUrl] = useState("");
  const [symbol, setSymbol] = useState("");
  const [propertyParent1, setProperty1] = useState("");
  const [propertyAtributte1, setAtributte1] = useState("");
  const [propertyParent2, setProperty2] = useState("");
  const [propertyAtributte2, setAtributte2] = useState("");
  const [propertyParent3, setProperty3] = useState("");
  const [propertyAtributte3, setAtributte3] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();

    alert(`Submitting Collection Name: "${collectionName}", Description: "${description}", Short Url: ${shortUrl} `)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="property">YOU ARE CREATING COLLECTION
        <div>
          <label for="collectionName">AssetGuid:</label>

          <input
            className="input" 
            type="text"
            id="collectionName"
            name="collectionName"
            value={collectionName}
            onChange={(event) => setCollectionName(event.target.value)}
          />

          <label for="description">Value:</label>

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
            id="shortURL"
            name="shortURL"
            value={shortUrl}
            onChange={(event) => setShortUrl(event.target.value)}
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
      </div>

      <div className="property">
        <input
          type="text"
          id="lname"
          name="lname"
          placeholder="Property 1"
          value={propertyParent1}
          onChange={e =>  setProperty1(e.target.value)}
        />

        <input
          type="text"
          id="lname"
          name="lname"
          placeholder="Property 2"
          value={propertyParent2}
          onChange={e =>  setProperty2(e.target.value)}
        />

        <input
          type="text"
          id="lname"
          name="lname"
          placeholder="Property 3"
          value={propertyParent3}
          onChange={e =>  setProperty3(e.target.value)}
        />

        <input
          type="text"
          id="lname"
          name="lname"
          placeholder="Atributte 1"
          value={propertyAtributte1}
          onChange={e => setAtributte1(e.target.value)}
        />

        <input
          type="text"
          id="lname"
          name="lname"
          placeholder="Atributte 2"
          value={propertyAtributte2}
          onChange={e =>  setAtributte2(e.target.value)}
        />

        <input
          type="text"
          id="lname"
          name="lname"
          placeholder="Atributte 3"
          value={propertyAtributte3}
          onChange={e =>  setAtributte3(e.target.value)}
        />

        <input className="button" type="submit" value="CREATE"/>
      </div>   
    </form>
  );
}//v

export default FormCollection;