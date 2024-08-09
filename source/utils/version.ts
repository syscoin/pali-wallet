// This function compares two versions. The format should be {major}.{minor}.{patch}
// The function returns -1 if the first version (v1) is less than the second (v2), 1 if the first version (v1) is greater than the second (v2), and 0 if they are equal.
export const compareVersions = (v1: string, v2: string): number => {
  const v1Parts = v1.split('.').map(Number);
  const v2Parts = v2.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    if (v1Parts[i] > v2Parts[i]) {
      return 1;
    } else if (v1Parts[i] < v2Parts[i]) {
      return -1;
    }
  }

  return 0;
};
