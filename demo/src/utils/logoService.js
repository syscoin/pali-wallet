import axios from "axios";

const api = axios.create({
  baseURL: "https://7or87ne1oj.execute-api.us-east-1.amazonaws.com/v2/",
});

export async function uploadLogo(token_id, image) {
  try {
    const formData = new FormData();

    formData.append("token_id", token_id);
    formData.append("image", image);

    const { data } = await api.post("token", formData);

    return data;
  } catch (error) {
    throw Error("error uploading image");
  }
}

export async function getLogo(token_id) {
  try {
    const { data } = await api.get(`token/${token_id}`);
    
    return data
  } catch (error) {
    throw Error("error getting image");
  }
}

export async function getAllLogo(ids) {
  try {
    const qs = ids.reduce((acc, cur) => {
      return acc ? `${acc}&ids=${cur}` : `ids=${cur}`;
    }, "");
  
    const { data } = await api.get(`tokens?${qs}`);

    return data;
  } catch (error) {
    throw Error("error getting images");
  }
}
