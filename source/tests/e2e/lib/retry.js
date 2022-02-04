async function retry(
  { retries, delay = 0, rejectionMessage = 'Retry limit reached' },
  functionToRetry
) {
  let attempts = 0;
  while (attempts <= retries) {
    if (attempts > 0 && delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      await functionToRetry();
      return;
    } catch (error) {
      console.error(error);
    } finally {
      attempts += 1;
    }
  }

  throw new Error(rejectionMessage);
}

module.exports = { retry };
