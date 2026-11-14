#define _GNU_SOURCE
#include "../android/src/main/cpp/PaliCredentialPublication.h"

#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#ifdef __linux__
#include <sys/syscall.h>
#endif

static const char *stem = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
static void create_record(int directory, const char *name, unsigned char value, size_t length) {
  const int fd = openat(directory, name, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0600);
  assert(fd >= 0);
  unsigned char bytes[103]; memset(bytes, value, sizeof(bytes));
  assert(length <= sizeof(bytes));
  assert(write(fd, bytes, length) == (ssize_t)length);
  assert(fsync(fd) == 0);
  assert(close(fd) == 0);
}
static void check_record(int directory, const char *name, unsigned char value) {
  const int fd = openat(directory, name, O_RDONLY | O_NOFOLLOW);
  assert(fd >= 0);
  unsigned char bytes[103]; assert(read(fd, bytes, sizeof(bytes)) == 102);
  for (size_t i = 0; i < 102; i++) assert(bytes[i] == value);
  assert(close(fd) == 0);
}

int main(void) {
  char directory[4096];
  const char *temporary = getenv("TMPDIR");
  assert(snprintf(directory, sizeof(directory), "%s/pali-credential-publication-XXXXXX",
                  temporary ? temporary : "/tmp") < (int)sizeof(directory));
  assert(mkdtemp(directory));
  const int folder = open(directory, O_RDONLY | O_DIRECTORY); assert(folder >= 0);
  char source[69], target[69];
  snprintf(source, sizeof(source), "%s.new", stem);
  snprintf(target, sizeof(target), "%s.bin", stem);
  assert(pali_credential_publish(directory, "../outside") == EINVAL);
  assert(pali_credential_publish(directory, "0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef") == EINVAL);
  assert(pali_credential_publish("relative", stem) == EINVAL);
  assert(pali_credential_publish(directory, stem) == ENOENT);

  create_record(folder, source, 1, 103);
  assert(pali_credential_publish(directory, stem) == EINVAL);
  assert(unlinkat(folder, source, 0) == 0);
  create_record(folder, source, 1, 102);
  assert(fchmodat(folder, source, 0644, 0) == 0);
  assert(pali_credential_publish(directory, stem) == EINVAL);
  assert(fchmodat(folder, source, 0600, 0) == 0);
  assert(linkat(folder, source, folder, "other", 0) == 0);
  assert(pali_credential_publish(directory, stem) == EINVAL);
  assert(unlinkat(folder, "other", 0) == 0);

  create_record(folder, target, 9, 102);
  const int collision = pali_credential_publish(directory, stem);
#if defined(__linux__) && defined(SYS_renameat2)
  assert(collision == EEXIST);
#else
  assert(collision == ENOSYS);
#endif
  check_record(folder, source, 1); check_record(folder, target, 9);
  assert(unlinkat(folder, target, 0) == 0);

  create_record(folder, "sentinel", 7, 102);
  assert(symlinkat("sentinel", folder, target) == 0);
  assert(pali_credential_publish(directory, stem) == collision);
  check_record(folder, source, 1); check_record(folder, "sentinel", 7);
  assert(unlinkat(folder, target, 0) == 0);
  assert(unlinkat(folder, source, 0) == 0);
  assert(symlinkat("sentinel", folder, source) == 0);
  assert(pali_credential_publish(directory, stem) != 0);
  check_record(folder, "sentinel", 7);
  assert(unlinkat(folder, source, 0) == 0);

  char linked_directory[sizeof(directory) + 8];
  snprintf(linked_directory, sizeof(linked_directory), "%s-link", directory);
  assert(symlink(directory, linked_directory) == 0);
  assert(pali_credential_publish(linked_directory, stem) != 0);
  assert(unlink(linked_directory) == 0);

  create_record(folder, source, 2, 102);
  const int published = pali_credential_publish(directory, stem);
#if defined(__linux__) && defined(SYS_renameat2)
  assert(published == 0);
  struct stat info;
  assert(fstatat(folder, source, &info, AT_SYMLINK_NOFOLLOW) != 0 && errno == ENOENT);
  check_record(folder, target, 2);
  assert(fsync(folder) == 0);
  assert(unlinkat(folder, target, 0) == 0);
#else
  assert(published == ENOSYS);
  check_record(folder, source, 2);
  assert(unlinkat(folder, source, 0) == 0);
#endif
  assert(unlinkat(folder, "sentinel", 0) == 0);
  assert(close(folder) == 0); assert(rmdir(directory) == 0);
  puts("Credential publication: scope, source integrity, collision, symlink and platform controls passed");
  return 0;
}
