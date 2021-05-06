import React, { useState } from "react";

 function FormCollect(props) {
  return (
    <form onSubmit={props.formCallback}>

  <div className="property">YOU ARE CREATING COLLECTION
      <div><label for="input">AssetGuid:</label>
          <input className="input" type="text" id="collectName" name="collectName" ></input>
           <label for="input">Description:</label>
          <input className="input" type="text" id="description" name="description"></input>
           <label for="input">Short Url:</label>
           <input className="input" type="text" id="shortUrl" name="shortUrl"></input>
           <label for="input">Symbol:</label>
              <input className="input" type="text" id="symbol" name="symbol" />  </div> </div>
        <div className="property">
          <input type="text" id="propertyParent1" name="propertyParent1" placeholder="Property 1"></input>
          <input type="text" id="propertyParent2" name="propertyParent2" placeholder="Property 2"></input>
          <input type="text" id="propertyParent3" name="propertyParent3" placeholder="Property 3" ></input>
          <input type="text" id="propertyAtributte1" name="propertyAtributte1" placeholder="Atributte 1" ></input>
          <input type="text" id="propertyAtributte2" name="propertyAtributte2" placeholder="Atributte 2" ></input>
          <input type="text" id="propertyAtributte3" name="propertyAtributte3" placeholder="Atributte 3" ></input></div>  
           <input className="button"type="submit" value="CREATE!"/>
    </form>
  );
}
  export default FormCollect;

