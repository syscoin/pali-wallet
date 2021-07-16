import axios from "axios";

const api = axios.create({
  baseURL: "https://1aitumq4tf.execute-api.sa-east-1.amazonaws.com/v2/",
  headers: {
    "x-api-key": "#877#W34D!RnP2$sU$s!"
  }
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
      return acc ? `${acc}&token_id=${cur}` : `token_id=${cur}`;
    }, "");
  
    const { data } = await api.get(`token?${qs}`);

    return data;
  } catch (error) {
    throw Error("error getting images");
  }
}
