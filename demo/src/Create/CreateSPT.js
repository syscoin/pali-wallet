import React, { Component, useEffect, useState, useCallback } from "react";
import 'bootstrap/dist/css/bootstrap.min.css';
import 'react-dropzone-uploader/dist/styles.css'
import Header from "../components/Header";
import FormCreateToken from '../components/FormCreateToken';

const CreateSPT = () => {
  const handleCreateToken = async (event, { precision, maxSupply, description, symbol, fee, sysAddress, rbf }) => {
    event.preventDefault();

    console.log(await window.ConnectionsController.getWalletState())

    console.log('handle create spt', precision, maxSupply, description, symbol, fee, sysAddress, rbf)

    // await controller.handleCreateToken(
    //   precision,
    //   symbol,
    //   maxSupply,
    //   fee,
    //   description,
    //   sysAddress,
    //   rbf
    // );
  }

  return (
    <div className="app">
      <Header />

      <div className="form">
        <FormCreateToken
          formCallback={handleCreateToken}
          token="SPT"
        />
      </div>
    </div>
  );
}
export default CreateSPT;




