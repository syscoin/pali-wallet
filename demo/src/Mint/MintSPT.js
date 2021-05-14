import React, { Component, useEffect, useState, useCallback } from "react";
import 'bootstrap/dist/css/bootstrap.min.css';
import 'react-dropzone-uploader/dist/styles.css';
import FormMintSPT from "./Form/FormMintSPT";
import Header from "../components/Header";

const MintSPT = () => {
  const handleIssueAsset = async (event, { amount, fee, description, rbf, assetGuid }) => {
    event.preventDefault();

    console.log(await window.ConnectionsController.getWalletState())

    console.log('handle mint spt', amount, fee, description, rbf, assetGuid)

    await window.ConnectionsController.handleIssueAsset(
      rbf,
      fee,
      assetGuid,
      amount,
      description
    );
  };
  

  return (
    <div className="app">
      <Header /> 
      <FormMintSPT formCallback={handleIssueAsset}/>
    </div>
    );
  }
  
  export default MintSPT;