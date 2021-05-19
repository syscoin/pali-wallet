import React, { Component, useEffect, useState, useCallback } from "react";
import 'bootstrap/dist/css/bootstrap.min.css';
import 'react-dropzone-uploader/dist/styles.css';
import FormMintSPT from "./Form/FormMintSPT";
import Header from "../components/Header";

const MintSPT = () => {
  const handleIssueSPT = async (
    event,
    amount,
    fee,
    receiver,
    rbf,
    assetGuid
  ) => {
    event.preventDefault();

    console.log(await window.ConnectionsController.getWalletState())

    console.log('handle mint spt', amount, fee, receiver, rbf, assetGuid)

    await window.ConnectionsController.handleIssueSPT(
      rbf,
      fee,
      assetGuid,
      amount,
      receiver
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