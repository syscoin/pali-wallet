#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const write = args.includes('--write');
const contractsRoot = option('--contracts-root');
const cast = option('--cast') || 'cast';

if (!contractsRoot) {
  throw new Error(
    'Usage: generate-pali-deployment.cjs --contracts-root <contracts> [--cast <cast>] [--write]'
  );
}

const walletRoot = path.resolve(__dirname, '..');
const deploymentPath = path.join(
  walletRoot,
  'source/utils/smartAccount/deployment.ts'
);
const contractsConfigPath = path.join(
  walletRoot,
  'source/utils/smartAccount/contracts.ts'
);
const artifactsRoot = path.join(path.resolve(contractsRoot), 'out');
const originalSource = fs.readFileSync(deploymentPath, 'utf8');
const contractsConfigSource = fs.readFileSync(contractsConfigPath, 'utf8');

const constant = (source, name) => {
  const match = source.match(
    new RegExp(`\\b${name}\\s*=\\s*\\n?\\s*'([^']+)'`)
  );
  if (!match) throw new Error(`Missing deployment constant: ${name}`);
  return match[1];
};

const literal = (source, key) => {
  const match = source.match(
    new RegExp(`\\b${key}:\\s*\\n\\s*'(0x[0-9a-fA-F]+)'`)
  );
  if (!match) throw new Error(`Missing deployment bytecode literal: ${key}`);
  return match[1].toLowerCase();
};

const replaceLiteral = (source, key, value) => {
  const pattern = new RegExp(`(\\b${key}:\\s*\\n\\s*)'(0x[0-9a-fA-F]+)'`);
  if (!pattern.test(source)) {
    throw new Error(`Missing deployment bytecode literal: ${key}`);
  }
  return source.replace(pattern, `$1'${value}'`);
};

const artifactBytecode = (sourceName, contractName, deployed = false) => {
  const artifactPath = path.join(
    artifactsRoot,
    `${sourceName}.sol`,
    `${contractName}.json`
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const bytecode = deployed
    ? artifact.deployedBytecode.object
    : artifact.bytecode.object;
  if (!/^0x[0-9a-fA-F]+$/.test(bytecode)) {
    throw new Error(`Artifact has no bytecode: ${artifactPath}`);
  }
  return bytecode.toLowerCase();
};

const runCast = (...castArgs) =>
  execFileSync(cast, castArgs, { encoding: 'utf8' }).trim();
const keccak = (data) => runCast('keccak', data).toLowerCase();
const abiAddress = (address) =>
  address.slice(2).padStart(64, '0').toLowerCase();
const appendAddresses = (bytecode, ...addresses) =>
  `${bytecode}${addresses.map(abiAddress).join('')}`;
const create2 = (deployer, salt, initCode) =>
  runCast(
    'create2',
    '--deployer',
    deployer,
    '--salt',
    salt,
    '--init-code-hash',
    keccak(initCode)
  ).toLowerCase();

const deployer = constant(originalSource, 'PALI_CREATE2_DEPLOYER_ADDRESS');
const entryPoint = constant(
  originalSource,
  'PALI_CANONICAL_ENTRYPOINT_ADDRESS'
).toLowerCase();
const version = constant(originalSource, 'PALI_INFRASTRUCTURE_VERSION');
const accountVersion = constant(
  contractsConfigSource,
  'PALI_SMART_ACCOUNT_VERSION'
);
if (accountVersion !== version) {
  throw new Error(
    `Deployment version ${version} does not match account version ${accountVersion}`
  );
}
const salt = (name) => keccak(`${version}:${name}`);
const names = {
  accountImplementation: 'account-implementation',
  compositeValidator: 'composite-validator',
  ecdsaValidator: 'ecdsa-validator',
  factory: 'factory',
  guardianRecoveryModule: 'guardian-recovery-module',
  p256WebAuthnValidator: 'p256-webauthn-validator',
  slhDsaValidator: 'slh-dsa-validator',
  slhDsaVerifier: 'slh-dsa-verifier',
};

const generated = {
  compositeValidator: artifactBytecode(
    'PaliCompositeValidatorModule',
    'PaliCompositeValidatorModule'
  ),
  ecdsaValidator: artifactBytecode(
    'PaliECDSAValidatorModule',
    'PaliECDSAValidatorModule'
  ),
  guardianRecoveryModule: artifactBytecode(
    'PaliGuardianRecoveryModule',
    'PaliGuardianRecoveryModule'
  ),
  p256WebAuthnValidator: artifactBytecode(
    'PaliP256WebAuthnValidatorModule',
    'PaliP256WebAuthnValidatorModule'
  ),
  slhDsaValidator: artifactBytecode(
    'PaliSLHDSAValidatorModule',
    'PaliSLHDSAValidatorModule'
  ),
  slhDsaVerifier: artifactBytecode(
    'SLHDSASHA212824Verifier',
    'SLHDSASHA212824Verifier'
  ),
};
generated.accountImplementation = appendAddresses(
  artifactBytecode('PaliSmartAccount', 'PaliSmartAccount'),
  entryPoint
);

const addresses = {
  accountImplementation: create2(
    deployer,
    salt(names.accountImplementation),
    generated.accountImplementation
  ),
};
generated.factory = appendAddresses(
  artifactBytecode('PaliSmartAccountFactory', 'PaliSmartAccountFactory'),
  addresses.accountImplementation,
  entryPoint
);

for (const id of [
  'ecdsaValidator',
  'p256WebAuthnValidator',
  'slhDsaVerifier',
  'compositeValidator',
  'guardianRecoveryModule',
  'factory',
]) {
  addresses[id] = create2(deployer, salt(names[id]), generated[id]);
}

const verifierRuntimeHash = keccak(
  artifactBytecode('SLHDSASHA212824Verifier', 'SLHDSASHA212824Verifier', true)
);
const slhDsaValidatorInitCode = `${generated.slhDsaValidator}${abiAddress(
  addresses.slhDsaVerifier
)}${verifierRuntimeHash.slice(2)}`;
addresses.slhDsaValidator = create2(
  deployer,
  salt(names.slhDsaValidator),
  slhDsaValidatorInitCode
);

let nextSource = originalSource;
for (const [key, bytecode] of Object.entries(generated)) {
  nextSource = replaceLiteral(nextSource, key, bytecode);
}
nextSource = nextSource.replace(
  /(const slhDsaVerifierCodeHash\s*=\s*\n?\s*)'(0x[0-9a-fA-F]+)'/,
  `$1'${verifierRuntimeHash}'`
);

let allMatch = true;
for (const id of Object.keys(generated)) {
  const matches = literal(originalSource, id) === generated[id];
  allMatch &&= matches;
  process.stdout.write(
    `${id}: bytecode=${matches ? 'MATCH' : 'DIFF'} address=${addresses[id]}\n`
  );
}
const pinnedVerifierHash = constant(originalSource, 'slhDsaVerifierCodeHash');
const verifierMatches =
  pinnedVerifierHash.toLowerCase() === verifierRuntimeHash.toLowerCase();
allMatch &&= verifierMatches;
process.stdout.write(
  `slhDsaVerifier runtime hash=${
    verifierMatches ? 'MATCH' : 'DIFF'
  } value=${verifierRuntimeHash}\n`
);

if (write) {
  fs.writeFileSync(deploymentPath, nextSource);
  process.stdout.write(`Updated ${deploymentPath}\n`);
} else if (!allMatch) {
  process.exitCode = 1;
}
