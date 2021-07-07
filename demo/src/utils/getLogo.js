import axios from "axios";

export default async function getLogo(file) {
  const { data } = await axios.get("https://en7tv7fnc3.execute-api.us-east-1.amazonaws.com/test/:assetId", file);

  return data;
}