import React, { Component, useEffect, useState, useCallback } from "react";
import 'bootstrap/dist/css/bootstrap.min.css';
import 'react-dropzone-uploader/dist/styles.css';
import Dropzone from 'react-dropzone-uploader';
import FormMintNFT from "./Form/FormMintNFT";
import Header from "../components/Header";

const MintNFT = () => {
  const [preview, setPreview] = useState("");
  
  const getUploadParams = () => ({
    url: 'https://api.nft.storage/upload',  
    headers: { "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkaWQ6ZXRocjoweGJiNUM1NzJkYmFlNDQ1MkFDOGFiZWZlMjk3ZTljREIyRmEzRjRlNzIiLCJpc3MiOiJuZnQtc3RvcmFnZSIsImlhdCI6MTYxOTcxMjM0MTgzNCwibmFtZSI6InN5cyJ9.KmVoWH8Sa0FNsPyWrPYEr1zCAdFw8bJwVnmzPsp_fg4"
    }
  });
  
  //"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5ASDASDAXCZg0NTY5MDEiLCJpc3MiOiJuZnQtc3RvcmFnZSIsImlhdCI6MTYxODU5NzczODM5NCwibmFtZSI6ImtleTEifQ.uNeFoDDU_M8uzTNTVQ3uYnxejjVNldno5nFuxzoOWMk"

  const handleChangeStatus = ({ meta, file, xhr }, status) => {
    if (xhr?.response){
      const {value: {cid}} = JSON.parse(xhr.response);

      setPreview(`https://ipfs.io/ipfs/${cid}/${file.name}`);

      console.log(`CID:${cid}`)
      console.log('meta: ', meta)
      console.log('file', file)
      console.log(`other information: `, JSON.parse(xhr.response));
      document.getElementById('out').innerHTML+= `${JSON.stringify(`CID:${cid}`)}\n`;
    }; 
  };

  const handleMintNFT = async (event, {
    nftName,
    description,
    maxShares,
    editions,
    royalites,
    property1,
    property2,
    property3,
    attribute1,
    attribute2,
    attribute3
  }) => {
    event.preventDefault();

    // call controller function and send parameters to use in the messages
    // await controller.handleMintNFT(
    //   nftName,
    //   description,
    //   maxShares,
    //   editions,
    //   royalites,
    //   property1,
    //   property2,
    //   property3,
    //   attribute1,
    //   attribute1,
    //   attribute1
    // )

    console.log(await window.ConnectionsController.getWalletState())

    console.log('items nft mint', nftName, description, maxShares, editions, royalites, property1, property2, property3, attribute1, attribute2, attribute3)
    console.log('handle issue asset mint nft');
  }

  return (
    <div className="app">
      <Header />

      <div>
        <Dropzone
          getUploadParams={getUploadParams}
          onChangeStatus={handleChangeStatus}
          accept='image/*, image/gif, audio/*, video/*, gif/*, .gif, .pdf, .mp3'
          inputContent={() => ( 'Drag Files')}
        />

        <pre
          className="cid"
          id="out"
        ></pre> 
      </div> 
            
      <iframe
        className="iframe"
        src={preview}
        href={preview}
      ></iframe>

      <div>
        <a
          className="button-2"
          href="/sysmint"
        >
          Clear
        </a>
      </div>

      <div className="form"> 
        <FormMintNFT formCallback={handleMintNFT} />          
      </div>
    </div>
  )
}
  
export default MintNFT;