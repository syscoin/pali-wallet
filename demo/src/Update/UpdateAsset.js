import React, { Component, useEffect, useState, useCallback } from "react";
import 'bootstrap/dist/css/bootstrap.min.css';
import 'react-dropzone-uploader/dist/styles.css';
import FormUpdateAsset from "./Form/FormUpdateAsset";
import Header from "../components/Header";

const UpdateAsset = () => {
  const handleUpdateAsset = async (
    event,
    assetGuid,
    contract,
    capabilityFlags,
    receiver,
    description,
    supply,
    endpoint,
    instanttransfers,
    hdrequired,
    auxFeeDetails,
    notarykeyid
  ) => {
    event.preventDefault();

    console.log(await window.ConnectionsController.getWalletState())

    console.log('mintpstpage', supply, receiver, assetGuid, auxFeeDetails)

    await window.ConnectionsController.handleUpdateAsset(
      assetGuid,
      contract,
      capabilityFlags,
      receiver,
      description,
      supply,
      endpoint,
      instanttransfers,
      hdrequired,
      auxFeeDetails,
      notarykeyid
    );
  };
  
  return (
    <div className="app">
      <Header /> 
      <FormUpdateAsset formCallback={handleUpdateAsset}/>
    </div>
    );
  }
  
  export default UpdateAsset;