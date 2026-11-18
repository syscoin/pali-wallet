const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { classifyAudit, checkTime, verifyPins, verifyContext } = require('../../../apps/mobile/scripts/check-dependency-advisories.cjs');
const policy = require('../../../apps/mobile/security/picomatch-exception.json');
const original = require('./picomatch-audit-current.json');
const clone = () => JSON.parse(JSON.stringify(original));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const count = report => {
 const n={info:0,low:0,moderate:0,high:0,critical:0,total:0};
 for(const row of Object.values(report.vulnerabilities)){n[row.severity]++;n.total++;}report.metadata.vulnerabilities=n;
};
const badLeaf = () => ({...original.vulnerabilities.picomatch.via[0],source:99999,url:'https://github.com/advisories/GHSA-aaaa-bbbb-cccc'});
test('actual current39-node npm report:35 high nodes resolve only to approved leaf despite Metro/RN cycles',()=>{
 assert.equal(original.vulnerabilities['metro-config'].via.includes('metro'),true);
 assert.equal(original.vulnerabilities.metro.via.includes('metro-config'),true);
 assert.deepEqual(classifyAudit(original,policy),{exceptedAdvisories:1,exceptedNodes:35,rawCounts:{info:0,low:4,moderate:0,high:35,critical:0,total:39},remainingModerateOrHigher:0});
});
for(const [title,mutate,error] of [
 ['direct unrelated high',r=>{r.vulnerabilities.extra={name:'extra',severity:'high',nodes:['node_modules/extra'],via:[badLeaf()]};count(r);},'UNAPPROVED_ADVISORY'],
 ['hidden transitive high',r=>{r.vulnerabilities.extra={name:'extra',severity:'high',nodes:['node_modules/extra'],via:[badLeaf()]};r.vulnerabilities.micromatch.via.push('extra');count(r);},'UNAPPROVED_ADVISORY'],
 ['mixed leaf on known package',r=>r.vulnerabilities.picomatch.via.push(badLeaf()),'UNAPPROVED_ADVISORY'],
 ['same title different GHSA',r=>{r.vulnerabilities.picomatch.via[0].url='https://github.com/advisories/GHSA-aaaa-bbbb-cccc';},'UNAPPROVED_ADVISORY'],
 ['changed source',r=>{r.vulnerabilities.picomatch.via[0].source++;},'UNAPPROVED_ADVISORY'],
 ['changed range',r=>{r.vulnerabilities.picomatch.via[0].range='*';},'UNAPPROVED_ADVISORY'],
 ['changed leaf severity',r=>{r.vulnerabilities.picomatch.via[0].severity='critical';},'AUDIT_SEVERITY_DRIFT'],
 ['missing reference',r=>r.vulnerabilities.micromatch.via.push('missing'),'AUDIT_REFERENCE'],
 ['terminal-free cycle',r=>{r.vulnerabilities.extra={name:'extra',severity:'high',nodes:['node_modules/extra'],via:['extra']};count(r);},'AUDIT_NO_TERMINAL'],
 ['missing terminal',r=>{r.vulnerabilities.picomatch.via=[];},'AUDIT_SCHEMA'],
 ['unknown severity',r=>{r.vulnerabilities.picomatch.severity='unknown';},'AUDIT_SCHEMA'],
 ['wrong metadata counts',r=>{r.metadata.vulnerabilities.high--;},'AUDIT_COUNTS'],
 ['new schema',r=>{r.auditReportVersion=3;},'AUDIT_SCHEMA'],
 ['registry error',r=>{r.error={code:'REGISTRY_UNAVAILABLE'};},'AUDIT_SCHEMA'],
 ['missing install node',r=>{r.vulnerabilities.picomatch.nodes.pop();},'AUDIT_INSTALL_INVENTORY'],
 ['extra install node',r=>{r.vulnerabilities.picomatch.nodes.push('node_modules/extra/node_modules/picomatch');},'AUDIT_INSTALL_INVENTORY'],
 ['bad leaf shape',r=>{delete r.vulnerabilities.picomatch.via[0].source;},'AUDIT_LEAF'],
 ['oversized graph',r=>{for(let i=0;i<260;i++)r.vulnerabilities['x'+i]={name:'x'+i,severity:'high',nodes:['node_modules/x'+i],via:['picomatch']};},'AUDIT_BOUND'],
])test('refuses '+title,()=>{const r=clone();mutate(r);assert.throws(()=>classifyAudit(r,policy),new RegExp(error));});
test('a new low leaf is still below the unchanged moderate threshold',()=>{const r=clone();r.vulnerabilities.extra={name:'extra',severity:'low',nodes:['node_modules/extra'],via:[{...badLeaf(),severity:'low'}]};count(r);assert.equal(classifyAudit(r,policy).rawCounts.low,5);});
test('expiry, not-before and invalid clock fail closed',()=>{
 checkTime(policy,Date.parse('2026-11-18T00:00:00Z'));
 for(const now of [Date.parse(policy.notBefore)-1,Date.parse(policy.expiresAt),NaN])assert.throws(()=>checkTime(policy,now),/POLICY_EXPIRED/);
});
function contextFixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pali-audit-policy-draft-'));fs.mkdirSync(path.join(root,'src'));fs.writeFileSync(path.join(root,'src','entry.js'),'module.exports=1;');
 execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['add','src/entry.js'],{cwd:root});
 const sourceHash=digest(fs.readFileSync(path.join(root,'src','entry.js'))),inputHash=digest(JSON.stringify([['src/entry.js',sourceHash]]));
 const pkg={path:'node_modules/picomatch',name:'picomatch',version:'4.0.7',resolved:'https://registry.npmjs.org/picomatch/-/picomatch-4.0.7.tgz',integrity:'sha512-test',sha256:{'index.js':digest('module.exports=1;')}};
 fs.mkdirSync(path.join(root,'apps/mobile/node_modules/picomatch'),{recursive:true});fs.writeFileSync(path.join(root,'apps/mobile/node_modules/picomatch/package.json'),JSON.stringify({name:'picomatch',version:'4.0.7'}));fs.writeFileSync(path.join(root,'apps/mobile/node_modules/picomatch/index.js'),'module.exports=1;');
 fs.writeFileSync(path.join(root,'apps/mobile/package-lock.json'),JSON.stringify({packages:{[pkg.path]:pkg}}));
 const receipt={productionInputs:{sha256:inputHash},android:{verifiedSourceContents:1,packageNameOrContentHits:{picomatch:[]}},canary:{nodes:1,moduleHits:{picomatch:[]}}};fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify(receipt));
 return {root,p:{...policy,repositoryPins:{'src/entry.js':sourceHash},sourcePins:{},consumerPins:{},productionInputs:{selectors:['src'],excludedPolicyHelper:'not-a-product-file',files:1,sha256:inputHash},mobileInstalledPackages:[pkg],runtimeReceipt:{path:'receipt.json',sha256:digest(JSON.stringify(receipt))}},clean:()=>fs.rmSync(root,{force:true,recursive:true})};
}
test('exact source/consumer/package context qualifies; source, inventory, parser and version drift refuse',()=>{
 for(const mutation of ['source','new source','parser','version','extra install','physical shadow','aliased copy','receipt','symlink']){const f=contextFixture();try{
  verifyContext(f.root,f.p,Date.parse('2026-11-18T00:00:00Z'));
  if(mutation==='source')fs.appendFileSync(path.join(f.root,'src/entry.js'),'x');
  if(mutation==='new source'){fs.writeFileSync(path.join(f.root,'src/new.js'),'new');execFileSync('git',['add','src/new.js'],{cwd:f.root});}
  if(mutation==='parser')fs.appendFileSync(path.join(f.root,'apps/mobile/node_modules/picomatch/index.js'),'x');
  if(mutation==='version')fs.writeFileSync(path.join(f.root,'apps/mobile/node_modules/picomatch/package.json'),JSON.stringify({name:'picomatch',version:'4.0.8'}));
  if(mutation==='extra install'){const file=path.join(f.root,'apps/mobile/package-lock.json'),l=JSON.parse(fs.readFileSync(file));l.packages['node_modules/x/node_modules/picomatch']=l.packages['node_modules/picomatch'];fs.writeFileSync(file,JSON.stringify(l));}
  if(mutation==='physical shadow'||mutation==='aliased copy'){
    const parent=path.join(f.root,'apps/mobile/node_modules/x');fs.mkdirSync(parent,{recursive:true});fs.writeFileSync(path.join(parent,'package.json'),JSON.stringify({name:'x',version:'1.0.0'}));
    const extra=path.join(parent,'node_modules',mutation==='aliased copy'?'alias':'picomatch');fs.mkdirSync(extra,{recursive:true});fs.writeFileSync(path.join(extra,'package.json'),JSON.stringify({name:'picomatch',version:'4.0.7'}));
  }
  if(mutation==='receipt')fs.appendFileSync(path.join(f.root,'receipt.json'),' ');
  if(mutation==='symlink'){fs.renameSync(path.join(f.root,'src/entry.js'),path.join(f.root,'outside.js'));fs.symlinkSync(path.join(f.root,'outside.js'),path.join(f.root,'src/entry.js'));}
  assert.throws(()=>verifyContext(f.root,f.p,Date.parse('2026-11-18T00:00:00Z')),/DRIFT|SYMLINK/);
 }finally{f.clean();}}
});
test('path traversal and missing pins fail closed',()=>{const f=contextFixture();try{assert.throws(()=>verifyPins(f.root,{'../elsewhere':'x'}),/PIN_PATH/);assert.throws(()=>verifyPins(f.root,{'absent':'x'}));}finally{f.clean();}});
test('CLI cannot activate an unapproved policy',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pali-audit-unapproved-'));
 try {
  const script=path.join(root,'apps/mobile/scripts/check-dependency-advisories.cjs');
  const security=path.join(root,'apps/mobile/security');
  fs.mkdirSync(path.dirname(script),{recursive:true});fs.mkdirSync(security,{recursive:true});
  fs.copyFileSync(path.resolve(__dirname,'../../../apps/mobile/scripts/check-dependency-advisories.cjs'),script);
  fs.writeFileSync(path.join(security,'picomatch-exception.json'),JSON.stringify({...policy,status:'PROPOSED'}));
  const result=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:5000});
  assert.equal(result.status,1);assert.match(result.stderr,/POLICY_NOT_APPROVED/);
 } finally { fs.rmSync(root,{recursive:true,force:true}); }
});


test('reviewed Android entry and actual Expo/Babel/TS/root build configs are covered',()=>{
 const inputs=policy.productionInputs.selectors;
 for(const required of ['apps/mobile/App.tsx','apps/mobile/app.json','apps/mobile/app.config.cjs','apps/mobile/babel.config.cjs','apps/mobile/tsconfig.json','.babelrc','tsconfig.json','manifest.json'])assert(inputs.includes(required),required);
 assert(!inputs.includes('apps/mobile/app.config.ts'));assert(!inputs.includes('apps/mobile/babel.config.js'));
});

test('interpreter drift invalidates the reviewed context',()=>{const f=contextFixture();try{f.p.nodeVersion='v999.0.0';assert.throws(()=>verifyContext(f.root,f.p,Date.parse('2026-11-18T00:00:00Z')),/NODE_VERSION_DRIFT/);}finally{f.clean();}});


test('new uppercase Metro platform App sibling invalidates the reviewed input fence',()=>{
 assert(policy.productionInputs.selectors.includes('apps/mobile/App.*'));
 for(const sibling of ['App.android.tsx','App.ios.tsx','App.native.tsx']){
  const f=contextFixture();try{
   f.p.productionInputs.selectors=['src','apps/mobile/App.*'];
   fs.writeFileSync(path.join(f.root,'apps/mobile/App.tsx'),'module.exports=1;');execFileSync('git',['add','apps/mobile/App.tsx'],{cwd:f.root});
   const files=execFileSync('git',['ls-files','-z','--',...f.p.productionInputs.selectors],{cwd:f.root,encoding:'utf8'}).split('\0').filter(Boolean).sort();
   f.p.productionInputs.files=files.length;f.p.productionInputs.sha256=digest(JSON.stringify(files.map(p=>[p,digest(fs.readFileSync(path.join(f.root,p)))])));
   const rp=path.join(f.root,'receipt.json'),r=JSON.parse(fs.readFileSync(rp));r.productionInputs.sha256=f.p.productionInputs.sha256;fs.writeFileSync(rp,JSON.stringify(r));f.p.runtimeReceipt.sha256=digest(JSON.stringify(r));
   verifyContext(f.root,f.p,Date.parse('2026-11-18T00:00:00Z'));
   fs.writeFileSync(path.join(f.root,'apps/mobile',sibling),'module.exports=require("picomatch");');execFileSync('git',['add','apps/mobile/'+sibling],{cwd:f.root});
   assert.throws(()=>verifyContext(f.root,f.p,Date.parse('2026-11-18T00:00:00Z')),/PRODUCTION_INPUT_DRIFT/);
  }finally{f.clean();}
 }
});
