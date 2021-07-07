import axios from "axios";

export default async function upload(url, file, ...rest) {
  const headers = rest.find((param) => typeof param === "object");
  const onUploadProgress = rest.find((param) => typeof param === "function");

  const { data } = await axios.post(url, file, {
    ...(headers && { headers }),
    ...(onUploadProgress && { onUploadProgress }),
  });

  return data;
}
