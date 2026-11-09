/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');

/** Only the generated wrapper's distribution-download transport is changed. */
function configureGradleWrapperDownload(root) {
  const directory = path.join(fs.realpathSync(root), 'android/gradle/wrapper');
  if (fs.realpathSync(directory) !== directory) throw Error('GRADLE_WRAPPER_PROPERTIES_INVALID');
  const file = path.join(directory, 'gradle-wrapper.properties');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384)
    throw Error('GRADLE_WRAPPER_PROPERTIES_INVALID');
  const text = fs.readFileSync(file, 'utf8');
  const properties = text.split(/\r?\n/).filter(line => line.trim() && !/^[ \t]*[#!]/.test(line));
  // Accept the template's canonical property form only, so Java property escapes,
  // continuations or duplicate keys cannot hide a different effective timeout.
  if (properties.some(line => !/^[A-Za-z][A-Za-z0-9.]*=/.test(line) || line.endsWith('\\')))
    throw Error('GRADLE_WRAPPER_PROPERTIES_INVALID');
  const timeouts = properties.filter(line => line.startsWith('networkTimeout='));
  if (timeouts.length !== 1 || !/^networkTimeout=(10000|60000)$/.test(timeouts[0]))
    throw Error('GRADLE_WRAPPER_PROPERTIES_INVALID');
  if (timeouts[0] === 'networkTimeout=10000')
    fs.writeFileSync(file, text.replace(/^networkTimeout=10000(?=\r?$)/m, 'networkTimeout=60000'));
}

module.exports = { configureGradleWrapperDownload };
if (require.main === module) configureGradleWrapperDownload(path.resolve(__dirname, '..'));
