function exitWithError(errorMessage) {
  console.error(errorMessage);
  process.exitCode = 1;
}

module.exports = { exitWithError };
