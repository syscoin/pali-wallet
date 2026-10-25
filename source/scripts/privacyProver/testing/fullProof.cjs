// Offline qualification: pass the SHA-256-pinned public key file as argv[2].
const fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto'),assert=require('assert/strict');
const {Worker}=require('worker_threads');
const {performance}=require('perf_hooks');
const directory=path.resolve(__dirname,'..');
const create=require('../witnessFactory.js'), build=require('../groth16Runtime.js');
const {unstringifyBigInts}=require('../vendor/stringifybigint.js');
const verify=require('../vendor/verifier_groth.js');
(async()=>{
 const begin=performance.now();const inputFile=require('../../../utils/privacy/prover.fixture.json');
 const input={...inputFile.input};
 for(const key of ['root','nullifierHash','recipient','relayer'])input[key]=BigInt(input[key]).toString();
 input.pathElements=input.pathElements.map(x=>BigInt(x).toString());
 const circuit=create(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(directory,'assets/metadata.json.gz')))));
 const witness=circuit.calculateWitness(input), publicSignals=witness.slice(1,7).map(String);
 assert.equal(crypto.createHash('sha256').update(witness.map(String).join('\n')).digest('hex'),inputFile.witnessSha256);
 const buffer=new ArrayBuffer(witness.length*32),view=new DataView(buffer);
 for(let i=0;i<witness.length;i++)for(let j=0;j<8;j++)view.setUint32(i*32+j*4,Number((witness[i]>>BigInt(j*32))&BigInt('4294967295')),true);
 witness.fill(BigInt(0));
 const key=fs.readFileSync(process.argv[2]);assert.equal(key.length,14522256);assert.equal(crypto.createHash('sha256').update(key).digest('hex'),'8e2d2f22beafb5a9666daebca57b13f8029c3656c65fcfbcc86e2418fa16a3af');
 const workers=[];
 const createWorker=()=>{
  const worker=new Worker(path.join(__dirname,'nodeSubworker.cjs'));workers.push(worker);
  return {postMessage:(data,transfers)=>worker.postMessage(data,transfers),set onmessage(fn){worker.on('message',data=>fn({data}));},terminate:()=>worker.terminate()};
 };
 const engine=await build({wasmInitialMemory:1000,workerCount:2,createWorker,wasmCode:new Uint8Array(fs.readFileSync(path.join(directory,'assets/groth16.wasm')))});
 let proof;
 try {proof=await engine.proof(buffer,key.buffer.slice(key.byteOffset,key.byteOffset+key.byteLength));}
 finally {engine.terminate();for(const worker of workers)await worker.terminate();new Uint8Array(buffer).fill(0);}
 const vk=unstringifyBigInts(require('../assets/verification-key.json'));const signals=unstringifyBigInts(publicSignals);
 assert(verify(vk,unstringifyBigInts(proof),signals));
 for(let i=0;i<6;i++){const modified=[...signals];modified[i]+=BigInt(1);assert(!verify(vk,unstringifyBigInts(proof),modified));}
 console.log(JSON.stringify({synthetic:true,networkRequests:0,actualProductionRuntime:true,staticSubworkers:true,proofVerified:true,publicInputMutationsRejected:6,witnessSha256:inputFile.witnessSha256,elapsedMs:performance.now()-begin,maxRssKiB:process.resourceUsage().maxRSS}));
})().catch(error=>{console.error(error.message);process.exitCode=1});
