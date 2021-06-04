import React, { useState } from "react";
import { useSelector } from "react-redux";

import "bootstrap/dist/css/bootstrap.min.css";
import "react-dropzone-uploader/dist/styles.css";

import Dropzone from "react-dropzone-uploader";
import FormMintNFT from "../components/Forms/FormMintNFT";

const MintNFT = () => {
  const controller = useSelector((state) => state.controller);
  const [preview, setPreview] = useState("");

  const getUploadParams = () => ({
    url: "https://api.nft.storage/upload",
    headers: {
      Authorization:
        "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkaWQ6ZXRocjoweGJiNUM1NzJkYmFlNDQ1MkFDOGFiZWZlMjk3ZTljREIyRmEzRjRlNzIiLCJpc3MiOiJuZnQtc3RvcmFnZSIsImlhdCI6MTYxOTcxMjM0MTgzNCwibmFtZSI6InN5cyJ9.KmVoWH8Sa0FNsPyWrPYEr1zCAdFw8bJwVnmzPsp_fg4",
    },
  });

  //"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5ASDASDAXCZg0NTY5MDEiLCJpc3MiOiJuZnQtc3RvcmFnZSIsImlhdCI6MTYxODU5NzczODM5NCwibmFtZSI6ImtleTEifQ.uNeFoDDU_M8uzTNTVQ3uYnxejjVNldno5nFuxzoOWMk"

  const handleChangeStatus = ({ meta, file, xhr }, status) => {
    if (xhr?.response) {
      const {
        value: { cid },
      } = JSON.parse(xhr.response);

      setPreview(`https://ipfs.io/ipfs/${cid}/${file.name}`);

      document.getElementById("out").innerHTML += `${JSON.stringify(
        `CID:${cid}`
      )}\n`;
    }
  };

  const handleMintNFT = async (event, assetGuid, nfthash, receiver) => {
    event.preventDefault();

    // call controller function and send parameters to use in the messages
    await controller.handleIssueNFT(assetGuid, nfthash, receiver);
  };

  return (
    <div>
      <div>
        <Dropzone
          getUploadParams={getUploadParams}
          onChangeStatus={handleChangeStatus}
          accept="image/*, image/gif, audio/*, video/*, gif/*, .gif, .pdf, .mp3"
          inputContent={() => "Drag Files"}
        />

        <pre className="cid" id="out"></pre>
      </div>

      <iframe className="iframe" src={preview} href={preview}></iframe>

      <div>
        <a className="button-2" href="/sysmint">
          Clear
        </a>
      </div>

      <div className="form">
        <FormMintNFT formCallback={handleMintNFT} />
      </div>
    </div>
  );
};

export default MintNFT;
