import axios from "axios";

const api = axios.create({
  baseURL: "https://1aitumq4tf.execute-api.sa-east-1.amazonaws.com/v2/",
  headers: {
    "x-api-key": "e2swJDX64l1NnODCI5Pt58TgjfPX7uXn1hmJqvyI"
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
    console.log(error)
  }
}

export async function getAllLogo(ids) {
  try {
    const qs = ids.reduce((acc, cur) => {
      return acc
        ? `${acc}&token_id=${cur.assetGuid}`
        : `token_id=${cur.assetGuid}`;
    }, "");
  
    const { data } = await api.get(`token?${qs}`);

    return data;
  } catch (error) {
    console.log(error)
  }
}
