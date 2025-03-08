/* eslint-disable */

const { execSync } = require('child_process');

const env = process.argv[2];
const targetBrowser = process.argv[3];
const command = process.argv.slice(4).join(' ');

process.env.NODE_ENV = env;
process.env.TARGET_BROWSER = targetBrowser;

console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`TARGET_BROWSER: ${process.env.TARGET_BROWSER}`);

execSync(command, { stdio: 'inherit' });
