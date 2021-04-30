import 'react-dropzone-uploader/dist/styles.css'
import Dropzone from 'react-dropzone-uploader'

const MyUploader = () => {
const getUploadParams = () => ({ url: 'https://api.nft.storage/upload',  
headers: { "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkaWQ6ZXRocjoweGJiNUM1NzJkYmFlNDQ1MkFDOGFiZWZlMjk3ZTljREIyRmEzRjRlNzIiLCJpc3MiOiJuZnQtc3RvcmFnZSIsImlhdCI6MTYxOTcxMjM0MTgzNCwibmFtZSI6InN5cyJ9.KmVoWH8Sa0FNsPyWrPYEr1zCAdFw8bJwVnmzPsp_fg4"
 }
})
;//"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5ASDASDAXCZg0NTY5MDEiLCJpc3MiOiJuZnQtc3RvcmFnZSIsImlhdCI6MTYxODU5NzczODM5NCwibmFtZSI6ImtleTEifQ.uNeFoDDU_M8uzTNTVQ3uYnxejjVNldno5nFuxzoOWMk"
const handleChangeStatus = ({ meta, file, xhr }, status) => {
 if (xhr?.response){
  const {value: {cid}} = JSON.parse(xhr.response)
  console.log(`CID:${cid}`)
  console.log('meta: ', meta)
  console.log('file', file)
  console.log(`other information: `, JSON.parse(xhr.response));
   document.getElementById('out').innerHTML+= `${JSON.stringify(
    `CID:${cid}`
  )}\n` 
}}
return (
<Dropzone
getUploadParams={getUploadParams}
onChangeStatus={handleChangeStatus}
accept='image/*, image/gif, audio/*, video/*, gif/*, .gif, .pdf, .mp3'
inputContent={() => ( 'Drag Files')}
/>
)
}
export default MyUploader; 
