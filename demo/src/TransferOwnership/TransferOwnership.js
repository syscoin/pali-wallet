import React, { Component, useEffect, useState, useCallback } from "react";
import 'bootstrap/dist/css/bootstrap.min.css';
import 'react-dropzone-uploader/dist/styles.css';
import FormTransferOwnership from "./Form/FormTransferOwnership";
import Header from "../components/Header";

const TransferOwnership = () => {
  const handleTransferOwnership = async (
    event,
    assetGuid,
    newOwner
  ) => {
    event.preventDefault();

    console.log(await window.ConnectionsController.getWalletState())

    await window.ConnectionsController.handleTransferOwnership(assetGuid, newOwner);
  };
  
  return (
    <div className="app">
      <Header /> 
      <FormTransferOwnership formCallback={handleTransferOwnership}/>
    </div>
    );
  }
  
  export default TransferOwnership;