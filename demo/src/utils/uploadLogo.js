import axios from "axios";

const onUploadProgress = (progressEvent) => {
  const { loaded, total } = progressEvent;
  const percentComplete = (loaded / total) * 100;

  console.log(`${Math.round(percentComplete)}%`);
};

export default async function uploadLogo(file) {
  const { data } = await axios.post("https://en7tv7fnc3.execute-api.us-east-1.amazonaws.com/test/form", file, {
    onUploadProgress,
  });

  return data;
}

