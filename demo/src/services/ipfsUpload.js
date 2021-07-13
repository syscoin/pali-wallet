import axios from "axios";

const onUploadProgress = (progressEvent) => {
  const { loaded, total } = progressEvent;
  const percentComplete = (loaded / total) * 100;

  console.log(`${Math.round(percentComplete)}%`);
};

export default async function ipfsUpload(file) {
  const { data } = await axios.post("https://api.nft.storage/upload", file, {
    headers: {
      Authorization:
        "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkaWQ6ZXRocjoweDdjMUMwYkY3MTAzMTcwMmNmZTg0N2YyNTA3MTdkNDEzRTA2MzU2ZjkiLCJpc3MiOiJuZnQtc3RvcmFnZSIsImlhdCI6MTYyMzM3MjgzMTA3MSwibmFtZSI6InRlc3QifQ.mnfpgmGmPrPhbdbDvVlbg9LJwIafRFTh03wBwqVQNUg",
    },
    onUploadProgress,
  });

  return data;
}