import { useEffect, useState } from "react";

export default function PreviewFile({ file }) {
  const [fileType, setFileType] = useState();

  useEffect(() => {
    file && setFileType(file.type);
  }, [file]);

  return (
    <>
      {fileType && (
        <>
          {fileType.startsWith("image") && (
            <img width="100px" src={URL.createObjectURL(file)} alt="" />
          )}
          {fileType.startsWith("video") && (
            <video
              width="100px"
              src={URL.createObjectURL(file)}
              controls
              controlsList="nodownload"
            />
          )}
          {fileType.startsWith("audio") && (
            <audio controls style={{ width: 150 }}>
              <source src={URL.createObjectURL(file)} type={file.type} />
            </audio>
          )}
        </>
      )}
    </>
  );
}
