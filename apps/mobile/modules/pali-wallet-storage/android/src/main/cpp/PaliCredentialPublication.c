#define _GNU_SOURCE
#include "PaliCredentialPublication.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#ifdef __linux__
#include <sys/syscall.h>
#endif

int pali_credential_publish(const char *directory, const char *stem) {
  if (!directory || directory[0] != '/' || !stem || strlen(stem) != 64) return EINVAL;
  for (size_t i = 0; i < 64; i++) {
    if (!((stem[i] >= '0' && stem[i] <= '9') || (stem[i] >= 'a' && stem[i] <= 'f'))) return EINVAL;
  }
  const int folder = open(directory, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (folder < 0) return errno;
  struct stat folder_info;
  int result = 0;
  if (fstat(folder, &folder_info) != 0) result = errno;
  else if (!S_ISDIR(folder_info.st_mode) || folder_info.st_uid != getuid()) result = EPERM;
  char source[69], target[69];
  snprintf(source, sizeof(source), "%s.new", stem);
  snprintf(target, sizeof(target), "%s.bin", stem);
  int input = -1;
  if (!result) {
    input = openat(folder, source, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (input < 0) result = errno;
  }
  if (!result) {
    struct stat info;
    if (fstat(input, &info) != 0) result = errno;
    else if (!S_ISREG(info.st_mode) || info.st_uid != getuid() || info.st_size != 102 ||
             (info.st_mode & 0777) != 0600 || info.st_nlink != 1) result = EINVAL;
  }
  if (!result) {
    // A direct libc reference needs API 30 even when this library loads earlier.
    // No fallback may replace an existing credential if this syscall is absent.
#if defined(__linux__) && defined(SYS_renameat2)
    if (syscall(SYS_renameat2, folder, source, folder, target, 1U /* RENAME_NOREPLACE */) != 0) result = errno;
#else
    result = ENOSYS;
#endif
  }
  if (!result && fsync(folder) != 0) result = errno;
  if (input >= 0) close(input);
  close(folder);
  return result;
}
