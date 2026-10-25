// Synthetic qualification harness only; not an extension entry point.
const {parentPort}=require('worker_threads');
const install=require('../subworkerRuntime.js');
const host={postMessage:(value,transfers)=>parentPort.postMessage(value,transfers),set onmessage(fn){parentPort.on('message',data=>fn({data}));},close:()=>process.exit(0)};
install(host);
