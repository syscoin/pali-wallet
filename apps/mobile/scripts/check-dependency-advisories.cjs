// Exact, expiring advisory exception approved by the user; all other moderate+ findings fail.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const rank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const fail = code => { throw Error(code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = x => x && typeof x === 'object' && !Array.isArray(x);
function classifyAudit(report, policy) {
  if (!object(report) || report.error || report.auditReportVersion !== 2 || !object(report.vulnerabilities) || !object(report.metadata?.vulnerabilities)) fail('AUDIT_SCHEMA');
  const nodes = Object.entries(report.vulnerabilities);
  if (nodes.length > 256) fail('AUDIT_BOUND');
  const graph = new Map(nodes), counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: nodes.length };
  let edges = 0;
  for (const [name, row] of nodes) {
    if (!object(row) || row.name !== name || !Object.hasOwn(rank, row.severity) || !Array.isArray(row.via) || !row.via.length || !Array.isArray(row.nodes) || !row.nodes.length || row.nodes.length > 128) fail('AUDIT_SCHEMA');
    counts[row.severity]++;
    for (const ref of row.via) {
      if (++edges > 4096) fail('AUDIT_BOUND');
      if (typeof ref === 'string') { if (!graph.has(ref)) fail('AUDIT_REFERENCE'); }
      else if (!object(ref) || !Number.isSafeInteger(ref.source) || ref.source <= 0 || !Object.hasOwn(rank, ref.severity) || !['name','dependency','url','range'].every(k => typeof ref[k] === 'string' && ref[k].length > 0 && ref[k].length <= 4096)) fail('AUDIT_LEAF');
    }
  }
  for (const [key, count] of Object.entries(counts)) if (report.metadata.vulnerabilities[key] !== count) fail('AUDIT_COUNTS');
  // Reach each terminal leaf once per root. Ordinary dependency cycles are not
  // exemptions: every component must still reach a real advisory terminal.
  let exceptedNodes = 0;
  for (const [name, row] of nodes) {
    const queue = [name], seen = new Set(), leaves = new Map();
    while (queue.length) {
      const current = queue.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      for (const via of graph.get(current).via) {
        if (typeof via === 'string') queue.push(via);
        else leaves.set(JSON.stringify([via.source,via.url,via.name,via.dependency,via.range,via.severity]),via);
      }
    }
    if (!leaves.size) fail('AUDIT_NO_TERMINAL');
    const maximum = Math.max(...Array.from(leaves.values(), x => rank[x.severity]));
    if (maximum !== rank[row.severity]) fail('AUDIT_SEVERITY_DRIFT');
    if (rank[row.severity] < rank.moderate) continue;
    for (const leaf of leaves.values()) if (rank[leaf.severity] >= rank.moderate && !['url','source','name','dependency','range','severity'].every(k => leaf[k] === policy.advisory[k])) fail('UNAPPROVED_ADVISORY');
    exceptedNodes++;
  }
  if (exceptedNodes) {
    const actual = graph.get('picomatch')?.nodes;
    const expected = policy.mobileInstalledPackages.map(x => x.path);
    if (!actual || JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) fail('AUDIT_INSTALL_INVENTORY');
  }
  return { exceptedAdvisories: exceptedNodes ? 1 : 0, exceptedNodes, rawCounts: counts, remainingModerateOrHigher: 0 };
}
function checkTime(policy, now) {
  const begin = Date.parse(policy.notBefore), end = Date.parse(policy.expiresAt);
  if (![begin,end,now].every(Number.isFinite) || begin >= end || now < begin || now >= end) fail('POLICY_EXPIRED');
}
function file(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) fail('PIN_PATH');
  const target = path.resolve(root,relative), prefix = path.resolve(root)+path.sep;
  if (!target.startsWith(prefix)) fail('PIN_PATH');
  let current = path.resolve(root);
  for (const part of path.relative(root,target).split(path.sep)) { current=path.join(current,part); if (fs.lstatSync(current).isSymbolicLink()) fail('PIN_SYMLINK'); }
  return target;
}
function verifyPins(root,pins) {
  for (const [relative, expected] of Object.entries(pins)) if (hash(fs.readFileSync(file(root,relative))) !== expected) fail('PIN_DRIFT');
}
function installedPicomatch(root) {
  const mobile = path.join(root,'apps/mobile'), found = []; let packages = 0;
  function inspect(directory) {
    if (++packages > 8192) fail('INSTALL_BOUND');
    const relative = path.relative(root,directory), metadata = file(root,relative+'/package.json');
    if (fs.statSync(metadata).size > 1024*1024) fail('INSTALL_BOUND');
    const pkg = JSON.parse(fs.readFileSync(metadata));
    if (!object(pkg) || typeof pkg.name !== 'string') fail('INSTALL_SHAPE');
    if (pkg.name === 'picomatch' || path.basename(directory) === 'picomatch') found.push(path.relative(mobile,directory).split(path.sep).join('/'));
    const nested=path.join(directory,'node_modules'); if(fs.existsSync(nested))walk(nested);
  }
  function walk(directory) {
    file(root,path.relative(root,directory));
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      if(entry.name.startsWith('.'))continue;
      const target=path.join(directory,entry.name);
      if(entry.isSymbolicLink())fail('PIN_SYMLINK');
      if(!entry.isDirectory())continue;
      if(entry.name.startsWith('@'))for(const child of fs.readdirSync(target,{withFileTypes:true})){
        if(child.isSymbolicLink())fail('PIN_SYMLINK');
        if(child.isDirectory())inspect(path.join(target,child.name));
      }else inspect(target);
    }
  }
  walk(path.join(mobile,'node_modules')); return found.sort();
}
function verifyContext(root,policy,now) {
  checkTime(policy,now);
  if(process.version!==policy.nodeVersion)fail('NODE_VERSION_DRIFT');
  verifyPins(root,{...policy.repositoryPins,...policy.sourcePins,...policy.consumerPins,[policy.runtimeReceipt.path]:policy.runtimeReceipt.sha256});
  const paths=execFileSync('git',['ls-files','-z','--',...policy.productionInputs.selectors],{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:2*1024*1024}).split('\0').filter(p=>p&&p!==policy.productionInputs.excludedPolicyHelper).sort();
  const inventory=paths.map(p=>[p,hash(fs.readFileSync(file(root,p)))]);
  if (paths.length!==policy.productionInputs.files || hash(JSON.stringify(inventory))!==policy.productionInputs.sha256) fail('PRODUCTION_INPUT_DRIFT');
  const lock=JSON.parse(fs.readFileSync(file(root,'apps/mobile/package-lock.json')));
  const actual=installedPicomatch(root),lockedPaths=Object.keys(lock.packages).filter(p=>/(^|\/)node_modules\/picomatch$/.test(p)).sort(),expected=policy.mobileInstalledPackages.map(p=>p.path).sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected)||JSON.stringify(lockedPaths)!==JSON.stringify(expected))fail('INSTALL_INVENTORY_DRIFT');
  for(const pkg of policy.mobileInstalledPackages){
    const installed=JSON.parse(fs.readFileSync(file(root,'apps/mobile/'+pkg.path+'/package.json'))),locked=lock.packages[pkg.path];
    if(installed.name!=='picomatch'||installed.version!==pkg.version||!['version','resolved','integrity'].every(k=>locked[k]===pkg[k]))fail('INSTALL_IDENTITY_DRIFT');
    verifyPins(root,Object.fromEntries(Object.entries(pkg.sha256).map(([p,h])=>['apps/mobile/'+pkg.path+'/'+p,h])));
  }
  const receipt=JSON.parse(fs.readFileSync(file(root,policy.runtimeReceipt.path)));
  if(receipt.productionInputs.sha256!==policy.productionInputs.sha256 || receipt.android.verifiedSourceContents<1 || receipt.canary.nodes<1 || Object.values(receipt.android.packageNameOrContentHits).some(x=>!Array.isArray(x)||x.length)||Object.values(receipt.canary.moduleHits).some(x=>!Array.isArray(x)||x.length))fail('RUNTIME_EVIDENCE_DRIFT');
  // Existing qualification verifies current artifact bytes against these
  // reviewed inputs. Any product/config/consumer change closes this attestation.
}
if(require.main===module){
  try{
    const root=path.resolve(__dirname,'../../..'),policy=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../security/picomatch-exception.json')));
    if(policy.status!=='APPROVED')fail('POLICY_NOT_APPROVED');
    verifyContext(root,policy,Date.now());
    const audit=spawnSync('npm',['audit','--json','--audit-level=moderate'],{cwd:path.join(root,'apps/mobile'),encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
    if(audit.error||audit.signal||![0,1].includes(audit.status))fail('AUDIT_EXECUTION');
    const report=JSON.parse(audit.stdout),result=classifyAudit(report,policy);
    if((audit.status===0)!==(result.rawCounts.moderate+result.rawCounts.high+result.rawCounts.critical===0))fail('AUDIT_EXIT_DRIFT');
    console.log(JSON.stringify({temporaryException:policy.advisory.url,expiresAt:policy.expiresAt,...result}));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={classifyAudit,checkTime,verifyPins,verifyContext};
