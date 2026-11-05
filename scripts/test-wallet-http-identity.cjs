/* Compile the production HTTP adapters into a disposable MV3 fixture and inspect actual wire headers. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const ts = require('typescript');
const { chromium } = require('playwright');

const sources = [
  'source/shared/paliHttpIdentity.ts',
  'source/scripts/Background/controllers/providers/walletHttpIdentity.ts',
  'source/scripts/Background/controllers/providers/patchFetchWithPaliHeaders.ts',
];
async function run() {
  const root = path.resolve(__dirname, '..');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pali-http-wire-'));
  const extension = path.join(directory, 'extension');
  const control = path.join(directory, 'control');
  const captures = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (req.url === '/page') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>HTTP control</title>'); return; }
    const parts = [];
    req.on('data', part => parts.push(part));
    req.on('end', () => {
      captures.push({ path: req.url, method: req.method, ua: req.headers['user-agent'], authorization: req.headers.authorization, body: Buffer.concat(parts).toString() });
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }); res.end('ok');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const unrelatedServer = http.createServer((req, res) => {
    captures.push({ path: req.url, method: req.method, ua: req.headers['user-agent'], body: '' });
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('ok');
  });
  await new Promise(resolve => unrelatedServer.listen(0, '127.0.0.1', resolve));
  const unrelatedOrigin = `http://127.0.0.1:${unrelatedServer.address().port}`;
  let context;
  const manifest = { manifest_version: 3, name: 'Pali HTTP wire fixture', version: '1.0.0', permissions: ['declarativeNetRequestWithHostAccess'], host_permissions: ['http://127.0.0.1/*'], background: { service_worker: 'worker.js', type: 'module' } };
  const hashes = {};
  try {
    await fs.mkdir(extension, { recursive: true }); await fs.mkdir(control, { recursive: true });
    for (const file of sources) {
      const source = await fs.readFile(path.join(root, file), 'utf8');
      hashes[file] = createHash('sha256').update(source).digest('hex');
      let compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
      compiled = compiled.replace(/(from ['"])(\.[^'"]+)(['"])/g, (_m, a, b, c) => `${a}${b}.js${c}`);
      const target = path.join(extension, file.replace(/\.ts$/, '.js'));
      await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, compiled);
    }
    await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
    await fs.writeFile(path.join(extension, 'page.html'), '<!doctype html><title>Pali HTTP fixture</title>');
    await fs.writeFile(path.join(extension, 'worker.js'), `import {createWalletHttpIdentity} from './source/scripts/Background/controllers/providers/walletHttpIdentity.js';\nimport {createPaliFetch} from './source/scripts/Background/controllers/providers/patchFetchWithPaliHeaders.js';\nconst identity=createWalletHttpIdentity(chrome.runtime.id,chrome.declarativeNetRequest);\nglobalThis.setup=url=>identity.configure([url]);\nglobalThis.walletFetch=createPaliFetch(fetch.bind(globalThis),identity);\nglobalThis.ready=true;
globalThis.testMalformed=async url=>{
 for(const subject of [createWalletHttpIdentity(chrome.runtime.id,chrome.declarativeNetRequest),identity]){
  let refused=false;
  try{await subject.configure([url,'malformed saved endpoint']);}catch{refused=true;}
  if(!refused)throw Error('MALFORMED_CONFIG_ACCEPTED');
  const guarded=createPaliFetch(fetch.bind(globalThis),subject);
  for(const method of ['GET','POST']){
   let sent=false;
   try{await guarded(url+'/malformed-no-send',{method,...(method==='POST'?{body:'010203'}:{})});sent=true;}catch{}
   if(sent)throw Error('MALFORMED_CONFIG_DISPATCHED');
  }
 }
 await identity.configure([url]);
 return {coldAndExistingManagers:2,blockedRequests:4};
};
globalThis.testConcurrency=async({url,candidate})=>{
 let nextHold;
 const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve};};
 const store={getDynamicRules:()=>chrome.declarativeNetRequest.getDynamicRules(),
  MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES:chrome.declarativeNetRequest.MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES,
  MAX_NUMBER_OF_DYNAMIC_RULES:chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_RULES,
  updateDynamicRules:async options=>{const hold=nextHold;nextHold=undefined;if(hold){hold.started.resolve();await hold.release.promise;}try{return await chrome.declarativeNetRequest.updateDynamicRules(options);}finally{hold?.done.resolve();}}};
 const manager=createWalletHttpIdentity(chrome.runtime.id,store);
 await manager.configure([url]);
 const hold=()=>{const value={started:deferred(),release:deferred(),done:deferred()};nextHold=value;return value;};
 const added=hold(),entered=deferred(),finish=deferred();
 const probing=manager.withBackend(candidate,async()=>{entered.resolve();await finish.promise;});
 await added.started.promise;
 const owned=createPaliFetch(fetch.bind(globalThis),manager);
 await owned(url+'/during-add',{method:'POST',headers:{Authorization:'Bearer public-add'},body:'active-add'});
 let newSent=false;try{await owned(candidate+'/new-origin-before-ack',{method:'POST',body:'must-not-send'});newSent=true;}catch{}
 if(newSent)throw Error('NEW_ORIGIN_DISPATCHED');
 added.release.resolve();await added.done.promise;await entered.promise;
 const removed=hold();finish.resolve();await removed.started.promise;
 await owned(url+'/during-remove',{method:'POST',headers:{Authorization:'Bearer public-remove'},body:'active-remove'});
 removed.release.resolve();await removed.done.promise;await probing;
 return {unrelatedAddAndRemove:true,newOriginBlocked:true};
};
globalThis.testCapacity=async ({url,uninstalledUrl})=>{
 const foreign={id:7,priority:1,action:{type:'modifyHeaders',requestHeaders:[{header:'x-public-fixture',operation:'set',value:'unchanged'}]},condition:{urlFilter:'|https://unrelated.public-fixture.invalid/'}};
 await chrome.declarativeNetRequest.updateDynamicRules({addRules:[foreign]});
 await identity.configure([url,...Array.from({length:1499},(_,n)=>'https://rpc-'+n+'.public-fixture.invalid')]);
 const before=await chrome.declarativeNetRequest.getDynamicRules();
 if(before.length!==1501||before.some(rule=>rule.condition.regexFilter))throw Error('LITERAL_CAPACITY_FAILED');
 const limit=chrome.declarativeNetRequest.MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES;
 let rejected=false;
 try{await identity.configure([url,uninstalledUrl,...Array.from({length:limit-2},(_,n)=>'https://capacity-'+n+'.public-fixture.invalid')]);}catch{rejected=true;}
 if(!rejected)throw Error('CAPACITY_NOT_REJECTED');
 let dispatched=false;
 try{await globalThis.walletFetch(uninstalledUrl+'/quota-no-send',{method:'POST',body:'010203'});dispatched=true;}catch{}
 if(dispatched)throw Error('UNIDENTIFIED_POST_DISPATCHED');
 await globalThis.walletFetch(url+'/after-failed-add',{method:'POST',headers:{Authorization:'Bearer public-after-failure'},body:'installed-still-ready'});
 const after=await chrome.declarativeNetRequest.getDynamicRules();
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('CAPACITY_CHANGED_EXISTING_RULES');
 await identity.configure([url]);
 const final=await chrome.declarativeNetRequest.getDynamicRules();
 if(!final.some(rule=>rule.id===7))throw Error('FOREIGN_RULE_REMOVED');
 return {literalOrigins:1500,unsafeLimit:limit,foreignRulesPreserved:true,overCapacityNoHttp:true,installedOriginAfterFailure:true};
};`);
    await fs.writeFile(path.join(control, 'manifest.json'), JSON.stringify({ ...manifest, name: 'Unrelated extension', permissions: [], background: { service_worker: 'worker.js' } }));
    await fs.writeFile(path.join(control, 'worker.js'), 'globalThis.control=true;');
    context = await chromium.launchPersistentContext(path.join(directory, 'profile'), { headless: true, channel: 'chromium', chromiumSandbox: true,
      args: [`--disable-extensions-except=${extension},${control}`, `--load-extension=${extension},${control}`] });
    let workers = context.serviceWorkers();
    for (let tries = 0; workers.length < 2 && tries < 10; tries++) { await new Promise(resolve => setTimeout(resolve, 100)); workers = context.serviceWorkers(); }
    const worker = (await Promise.all(workers.map(async w => [w, await w.evaluate(() => !!globalThis.ready)]))).find(([, ready]) => ready)?.[0];
    const unrelated = workers.find(w => w !== worker);
    assert(worker && unrelated, 'Both extension workers must start');
    const capacity = await worker.evaluate(args => globalThis.testCapacity(args), {url:origin,uninstalledUrl:unrelatedOrigin});
    assert(!captures.some(c => c.path === '/quota-no-send'));
    const malformedConfiguration = await worker.evaluate(url => globalThis.testMalformed(url), origin);
    assert(!captures.some(c => c.path === '/malformed-no-send'));
    await worker.evaluate(url => globalThis.setup(url), origin);
    const concurrency = await worker.evaluate(args => globalThis.testConcurrency(args), {url:origin,candidate:unrelatedOrigin});
    assert(!captures.some(c => c.path === '/new-origin-before-ack'));
    const single = '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}';
    const batch = `[${single}]`;
    await worker.evaluate(async ({origin,single,batch}) => {
      await globalThis.walletFetch(`${origin}/rpc-single`, {method:'POST',body:single,headers:{Authorization:'Bearer public-single'}});
      await globalThis.walletFetch(`${origin}/rpc-batch`, {method:'POST',body:batch,headers:new Headers({Authorization:'Bearer public-batch'})});
      await globalThis.walletFetch(`${origin}/api/v2/xpub/public-fixture`);
      await globalThis.walletFetch(`${origin}/api/v2/tx/public-fixture`);
      await globalThis.walletFetch(`${origin}/api/v2/sendtx/`, {method:'POST',body:'010203',headers:[['Authorization','Bearer public-raw']]});
      await globalThis.walletFetch(`${origin}/api?module=account&action=txlist`);
      await globalThis.walletFetch(new Request(`${origin}/request-body`, {method:'POST',body:single,headers:{Authorization:'Bearer public-request'}}));
    }, { origin, single, batch });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${worker.url().split('/')[2]}/page.html`);
    await page.evaluate(url => fetch(`${url}/extension-page`), origin);
    await unrelated.evaluate(url => fetch(`${url}/unrelated-extension`), origin);
    await worker.evaluate(url => globalThis.walletFetch(`${url}/unrelated-backend`), unrelatedOrigin);
    await page.goto(`${origin}/page`);
    await page.evaluate(url => fetch(`${url}/ordinary-page`), origin);
    const known = captures.filter(c => !['/unrelated-extension','/ordinary-page','/unrelated-backend'].includes(c.path));
    assert.equal(known.length, 11); for (const c of known) assert.equal(c.ua, 'PaliWallet', c.path);
    for (const p of ['/unrelated-extension','/ordinary-page','/unrelated-backend']) assert(!captures.find(c => c.path === p).ua.includes('PaliWallet'), p);
    for (const [p,body,authorization] of [['/rpc-single',single,'Bearer public-single'],['/rpc-batch',batch,'Bearer public-batch'],['/api/v2/sendtx/','010203','Bearer public-raw'],['/request-body',single,'Bearer public-request'],['/after-failed-add','installed-still-ready','Bearer public-after-failure'],['/during-add','active-add','Bearer public-add'],['/during-remove','active-remove','Bearer public-remove']]) {
      const c = captures.find(c => c.path === p); assert.equal(c.body,body); assert.equal(c.authorization,authorization); assert.equal(c.method,'POST');
      assert.equal(captures.filter(c => c.path === p).length,1);
    }
    await context.close();
    context = await chromium.launchPersistentContext(path.join(directory, 'profile'), { headless: true, channel: 'chromium', chromiumSandbox: true,
      args: [`--disable-extensions-except=${extension},${control}`, `--load-extension=${extension},${control}`] });
    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${worker.url().split('/')[2]}/page.html`);
    await reopened.evaluate(url => fetch(`${url}/browser-restart`), origin);
    assert.equal(captures.find(c => c.path === '/browser-restart').ua, 'PaliWallet');
    const report = { concurrency, malformedConfiguration, capacity, sourceSha256: hashes, browser: context.browser().version(), positiveCases: known.length, negativeCases:3, browserRestart: true, exactBodiesAndAuthorization:7, duplicatePosts:0 };
    const destination = process.env.PALI_HTTP_WIRE_REPORT;
    if (destination) await fs.writeFile(destination, JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  } finally {
    await context?.close(); await new Promise(resolve => server.close(resolve)); await new Promise(resolve => unrelatedServer.close(resolve)); await fs.rm(directory,{recursive:true,force:true});
  }
}
run().catch(error => { console.error(error); process.exitCode=1; });
