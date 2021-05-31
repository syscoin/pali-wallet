import React, { Component, useEffect, useState, useCallback } from "react";
import 'bootstrap/dist/css/bootstrap.min.css';
import 'react-dropzone-uploader/dist/styles.css';
import FormMintSPT from "./Form/FormMintSPT";
import Header from "../components/Header";
import store from "../state/store";
const MintSPT = () => {
  const handleIssueSPT = async (
    event,
    amount,
    receiver,
    assetGuid
  ) => {
    event.preventDefault();

    console.log(await window.ConnectionsController.getWalletState())

    console.log('mintpstpage', amount, receiver, assetGuid)

    await window.ConnectionsController.handleIssueSPT(
      amount,
      receiver,
      assetGuid
    );
  };
  
  return (
    <div className="app">
      <Header /> 
      <FormMintSPT formCallback={handleIssueSPT}/>
    </div>
    );
  }
  
  export default MintSPT;