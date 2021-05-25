import React, { Component, useEffect, useState, useCallback } from "react";
import 'bootstrap/dist/css/bootstrap.min.css';
import 'react-dropzone-uploader/dist/styles.css'
import Header from "../components/Header";
import FormCreateToken from '../components/FormCreateToken';
import  MyContext  from "../context"
const CreateNFT = () => {
  const handleCreateNFT = async (event, { precision, maxSupply, description, symbol, fee, sysAddress, rbf }) => {
    event.preventDefault();

    console.log(await window.ConnectionsController.getWalletState())

    // await controller.handleCreateNFT(precision, maxSupply, description, symbol, fee, sysAddress, rbf);

    console.log('handle create nft', precision, maxSupply, description, symbol, fee, sysAddress, rbf)
  }

  return (
    <div className="app">
      <div>
      <MyContext.Provider>
  <Header/>
  </MyContext.Provider> 
        <div className="form">
          <FormCreateToken
            formCallback={handleCreateNFT}
            token="NFT"
          />
        </div>
      </div>
    </div>
  );
}
export default CreateNFT;




