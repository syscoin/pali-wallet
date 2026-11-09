#include <jni.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <fcntl.h>
#include <dirent.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include "../../../../shared/slh/pali_slh_native.h"
#include "../../../../shared/slh/strict_rng.h"

JNIEXPORT jbyteArray JNICALL
Java_expo_modules_paliwalletcrypto_PaliSlhNative_publicFixtureSeed(JNIEnv *env, jclass type) {
  (void)type;
  jbyteArray result = (*env)->NewByteArray(env, PALI_SLH_SEED_BYTES);
  if (result != NULL) {
    (*env)->SetByteArrayRegion(env, result, 0, PALI_SLH_SEED_BYTES,
      (const jbyte *)pali_slh_qualification_seed());
  }
  return (*env)->ExceptionCheck(env) ? NULL : result;
}

JNIEXPORT jbyteArray JNICALL
Java_expo_modules_paliwalletcrypto_PaliSlhNative_leafChunk(
    JNIEnv *env, jclass type, jbyteArray seed, jint start, jint count) {
  (void)type;
  if (seed == NULL || (*env)->GetArrayLength(env, seed) != PALI_SLH_SEED_BYTES ||
      start < 0 || count <= 0 || count > PALI_SLH_MAX_LEAF_CHUNK ||
      start > PALI_SLH_XMSS_LEAVES - count) return NULL;
  uint8_t owned_seed[PALI_SLH_SEED_BYTES];
  (*env)->GetByteArrayRegion(env, seed, 0, PALI_SLH_SEED_BYTES, (jbyte *)owned_seed);
  if ((*env)->ExceptionCheck(env)) {
    pali_slh_erase(owned_seed, sizeof(owned_seed));
    return NULL;
  }
  const size_t size = (size_t)count * 16;
  uint8_t *output = malloc(size);
  if (output == NULL) { pali_slh_erase(owned_seed, sizeof(owned_seed)); return NULL; }
  const enum pali_slh_status status = pali_slh_leaf_chunk(owned_seed, sizeof(owned_seed),
      (uint32_t)start, (uint32_t)count, output, size);
  pali_slh_erase(owned_seed, sizeof(owned_seed));
  jbyteArray result = NULL;
  if (status == PALI_SLH_OK) {
    result = (*env)->NewByteArray(env, (jsize)size);
    if (result != NULL) (*env)->SetByteArrayRegion(env, result, 0, (jsize)size, (const jbyte *)output);
  }
  pali_slh_erase(output, size);
  free(output);
  return (*env)->ExceptionCheck(env) ? NULL : result;
}

/* Native-owned FDs only. None of these descriptor/path arguments is exported
 * by the Expo bridge; it accepts owner-bound tree SharedObjects instead. */
static int lower_hex(const char *text, size_t bytes) {
  for (size_t i = 0; i < bytes; i++)
    if (!((text[i] >= '0' && text[i] <= '9') || (text[i] >= 'a' && text[i] <= 'f'))) return 0;
  return 1;
}
static int leaf_name(const char *name, int partial) {
  const size_t hex = partial ? 32 : 64;
  const char *suffix = partial ? ".partial" : ".xmss";
  return strlen(name) == hex + strlen(suffix) && lower_hex(name, hex) && !strcmp(name + hex, suffix);
}
static int owned_file(int fd, int complete) {
  struct stat info;
  return fstat(fd, &info) == 0 && S_ISREG(info.st_mode) && info.st_nlink == 1 &&
      info.st_uid == getuid() && (info.st_mode & 0777) == 0600 &&
      (!complete || info.st_size == PALI_SLH_XMSS_TREE_BYTES);
}
static int linked_file(int directory, int fd, const char *name, int complete) {
  struct stat actual, linked;
  return owned_file(fd, complete) && fstat(fd, &actual) == 0 &&
      fstatat(directory, name, &linked, AT_SYMLINK_NOFOLLOW) == 0 &&
      S_ISREG(linked.st_mode) && actual.st_dev == linked.st_dev && actual.st_ino == linked.st_ino && linked.st_nlink == 1;
}
static int owned_directory(int fd) {
  struct stat info;
  return fstat(fd, &info) == 0 && S_ISDIR(info.st_mode) && info.st_uid == getuid() && (info.st_mode & 0777) == 0700;
}
JNIEXPORT jint JNICALL Java_expo_modules_paliwalletcrypto_PaliSlhNative_openNamespace(
    JNIEnv *env, jclass type, jstring base, jstring scope, jboolean create) {
  (void)type;
  if (!base || !scope || (*env)->GetStringUTFLength(env, scope) != 66 || (*env)->GetStringUTFLength(env, base) > 4096) return -1;
  const char *path = (*env)->GetStringUTFChars(env, base, NULL), *namespace = (*env)->GetStringUTFChars(env, scope, NULL);
  int parent = -1, root = -1, result = -1;
  if (!path || !namespace || strncmp(namespace, "0x", 2) || !lower_hex(namespace + 2, 64)) goto done;
  parent = open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (parent < 0) goto done;
  if (create && mkdirat(parent, "PaliSlhCache", 0700) != 0 && errno != EEXIST) goto done;
  root = openat(parent, "PaliSlhCache", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root < 0) { if (!create && errno == ENOENT) result = -2; goto done; }
  if (!owned_directory(root)) goto done;
  if (create && mkdirat(root, namespace + 2, 0700) != 0 && errno != EEXIST) goto done;
  result = openat(root, namespace + 2, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (result < 0) { result = !create && errno == ENOENT ? -2 : -1; goto done; }
  if (!owned_directory(result)) { close(result); result = -1; }
done:
  if (parent >= 0) close(parent); if (root >= 0) close(root);
  if (path) (*env)->ReleaseStringUTFChars(env, base, path);
  if (namespace) (*env)->ReleaseStringUTFChars(env, scope, namespace);
  return result;
}
JNIEXPORT jint JNICALL Java_expo_modules_paliwalletcrypto_PaliSlhNative_openTree(
    JNIEnv *env, jclass type, jint directory, jstring leaf, jboolean create) {
  (void)type; if (!leaf || !owned_directory(directory)) return -1;
  const char *name = (*env)->GetStringUTFChars(env, leaf, NULL); if (!name) return -1;
  int fd = -1;
  if (leaf_name(name, create)) {
    fd = openat(directory, name, (create ? O_RDWR | O_CREAT | O_EXCL : O_RDONLY) | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0 && !create && errno == ENOENT) fd = -2;
    if (fd >= 0 && !linked_file(directory, fd, name, !create)) { close(fd); fd = -1; }
  }
  (*env)->ReleaseStringUTFChars(env, leaf, name); return fd;
}
JNIEXPORT jboolean JNICALL Java_expo_modules_paliwalletcrypto_PaliSlhNative_reserveTree(JNIEnv *env, jclass type, jint fd) {
  (void)env; (void)type;
  /* Reserve physical blocks before writable mmap, never sparse ftruncate alone. */
  return owned_file(fd, 0) && posix_fallocate(fd, 0, PALI_SLH_XMSS_TREE_BYTES) == 0 &&
      ftruncate(fd, PALI_SLH_XMSS_TREE_BYTES) == 0 && owned_file(fd, 1);
}
JNIEXPORT jboolean JNICALL Java_expo_modules_paliwalletcrypto_PaliSlhNative_validateTree(
    JNIEnv *env, jclass type, jint directory, jint fd, jstring leaf) {
  (void)type; if (!leaf) return JNI_FALSE;
  const char *name = (*env)->GetStringUTFChars(env, leaf, NULL); if (!name) return JNI_FALSE;
  const int valid = owned_directory(directory) && (leaf_name(name, 0) || leaf_name(name, 1)) && linked_file(directory, fd, name, 1);
  (*env)->ReleaseStringUTFChars(env, leaf, name); return valid;
}
JNIEXPORT jboolean JNICALL Java_expo_modules_paliwalletcrypto_PaliSlhNative_closeDescriptor(JNIEnv *env, jclass type, jint fd) {
  (void)env; (void)type; return fd >= 0 && close(fd) == 0;
}
JNIEXPORT jboolean JNICALL Java_expo_modules_paliwalletcrypto_PaliSlhNative_abortTree(
    JNIEnv *env, jclass type, jint directory, jint fd, jstring leaf) {
  (void)type; if (!leaf) return JNI_FALSE;
  const char *name = (*env)->GetStringUTFChars(env, leaf, NULL); if (!name) return JNI_FALSE;
  int good = 0;
  if (owned_directory(directory) && leaf_name(name, 1)) {
    struct stat info;
    if (fstatat(directory, name, &info, AT_SYMLINK_NOFOLLOW) != 0 && errno == ENOENT) good = 1;
    else if (linked_file(directory, fd, name, 0)) good = unlinkat(directory, name, 0) == 0 && fsync(directory) == 0;
  }
  (*env)->ReleaseStringUTFChars(env, leaf, name); return good;
}
static int current(JNIEnv *env, jobject context) {
  if (!context) return 0;
  jclass type = (*env)->GetObjectClass(env, context);
  jmethodID method = type ? (*env)->GetMethodID(env, type, "isCurrentForSlhIO", "()Z") : NULL;
  const int good = method && (*env)->CallBooleanMethod(env, context, method);
  if (type) (*env)->DeleteLocalRef(env, type);
  return good && !(*env)->ExceptionCheck(env);
}
JNIEXPORT jint JNICALL Java_expo_modules_paliwalletcrypto_PaliSlhNative_publishTree(
    JNIEnv *env, jclass type, jint directory, jint fd, jstring from, jstring to, jobject context) {
  (void)type; if (!from || !to) return 0;
  const char *source = (*env)->GetStringUTFChars(env, from, NULL), *target = (*env)->GetStringUTFChars(env, to, NULL);
  int result = 0;
  if (source && target && leaf_name(source, 1) && leaf_name(target, 0) && owned_directory(directory) &&
      linked_file(directory, fd, source, 1) && fsync(fd) == 0 && current(env, context) &&
      renameat(directory, source, directory, target) == 0) {
    result = 2; /* Rename may have committed: never abort the former partial name as a final cache. */
    if (fsync(directory) == 0 && linked_file(directory, fd, target, 1) && current(env, context)) result = 1;
  }
  if (source) (*env)->ReleaseStringUTFChars(env, from, source);
  if (target) (*env)->ReleaseStringUTFChars(env, to, target); return result;
}
JNIEXPORT jint JNICALL Java_expo_modules_paliwalletcrypto_PaliSlhNative_purgeTrees(JNIEnv *env, jclass type, jint directory, jobject operation) {
  (void)type; if (!owned_directory(directory) || !current(env, operation)) return 0;
  const int copy = dup(directory); if (copy < 0) return 0;
  DIR *entries = fdopendir(copy); if (!entries) return close(copy) == 0 ? 0 : -1;
  rewinddir(entries);
  int good = 1, clean = 1; struct dirent *entry;
  for (;;) {
    errno = 0;
    entry = readdir(entries);
    if (!entry) { if (errno) good = 0; break; }
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    const int complete = leaf_name(entry->d_name, 0);
    if ((!complete && !leaf_name(entry->d_name, 1)) || !current(env, operation)) { good = 0; break; }
    const int fd = openat(directory, entry->d_name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) { good = 0; break; }
    struct stat info;
    const int owned = linked_file(directory, fd, entry->d_name, complete) && fstat(fd, &info) == 0 &&
        info.st_size >= 0 && info.st_size <= PALI_SLH_XMSS_TREE_BYTES;
    if (!owned || !current(env, operation) || unlinkat(directory, entry->d_name, 0) != 0) good = 0;
    if (close(fd) != 0) { good = 0; clean = 0; }
    if (!good) break;
  }
  if (closedir(entries) != 0) clean = 0;
  if (fsync(directory) != 0 || !current(env, operation)) good = 0;
  return !clean ? -1 : good;
}
static void *tree_map(int fd, int writable) {
  if (!owned_file(fd, 1)) return MAP_FAILED;
  return mmap(NULL, PALI_SLH_XMSS_TREE_BYTES, PROT_READ | (writable ? PROT_WRITE : 0), writable ? MAP_SHARED : MAP_PRIVATE, fd, 0);
}
static int release_map(JNIEnv *env, void *mapping, jobject tree) {
  if (munmap(mapping, PALI_SLH_XMSS_TREE_BYTES) == 0) return 1;
  /* Never authorize namespace purge/successor work after an undrained mapping. */
  jclass type = (*env)->GetObjectClass(env, tree);
  jmethodID method = type ? (*env)->GetMethodID(env, type, "markSlhMappingFailure", "()V") : NULL;
  if (method) (*env)->CallVoidMethod(env, tree, method);
  if (type) (*env)->DeleteLocalRef(env, type);
  return 0;
}
JNIEXPORT jbyteArray JNICALL Java_expo_modules_paliwalletcrypto_PaliSlhNative_readTreeRoot(JNIEnv *env, jclass type, jint fd) {
  (void)type; uint8_t bytes[16]; if (!owned_file(fd, 1) || pread(fd, bytes, 16, PALI_SLH_XMSS_TREE_BYTES - 16) != 16) return NULL;
  jbyteArray result = (*env)->NewByteArray(env, 16);
  if (result) (*env)->SetByteArrayRegion(env, result, 0, 16, (const jbyte *)bytes);
  pali_slh_erase(bytes, sizeof(bytes)); return (*env)->ExceptionCheck(env) ? NULL : result;
}
static int copy_bytes(JNIEnv *env, jbyteArray input, uint8_t *output, size_t size) {
  if (!input || (*env)->GetArrayLength(env, input) != (jsize)size) return 0;
  (*env)->GetByteArrayRegion(env, input, 0, (jsize)size, (jbyte *)output); return !(*env)->ExceptionCheck(env);
}
JNIEXPORT jboolean JNICALL Java_expo_modules_paliwalletcrypto_PaliSlhNative_writeTreeLeaves(
    JNIEnv *env, jclass type, jint fd, jint start, jbyteArray input) {
  (void)type; if (!input || !owned_file(fd, 1)) return JNI_FALSE;
  const jsize size = (*env)->GetArrayLength(env, input);
  if (size <= 0 || size > 8192 * 16 || size % 16 || start < 0 || start > PALI_SLH_XMSS_LEAVES - size / 16) return JNI_FALSE;
  uint8_t *bytes = malloc((size_t)size); if (!bytes) return JNI_FALSE;
  int good = copy_bytes(env, input, bytes, (size_t)size);
  size_t offset = 0;
  while (good && offset < (size_t)size) {
    const ssize_t count = pwrite(fd, bytes + offset, (size_t)size - offset, (off_t)start * 16 + (off_t)offset);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) { good = 0; break; } offset += (size_t)count;
  }
  pali_slh_erase(bytes, (size_t)size); free(bytes); return good;
}
JNIEXPORT jint JNICALL Java_expo_modules_paliwalletcrypto_PaliSlhNative_treeChunk(
    JNIEnv *env, jclass type, jbyteArray seed, jint fd, jint level, jint start, jint count, jobject owner) {
  (void)type; uint8_t bytes[48] = {0}; int result = -1;
  if (level < 0 || level > 22 || start < 0 || count <= 0 || count > 8192 || !copy_bytes(env, seed, bytes, 48)) goto done;
  void *tree = tree_map(fd, 1); if (tree == MAP_FAILED) goto done;
  if (pali_slh_tree_level(bytes, 48, tree, PALI_SLH_XMSS_TREE_BYTES, (uint32_t)level, (uint32_t)start, (uint32_t)count) == PALI_SLH_OK) result = count;
  if (!release_map(env, tree, owner)) result = -1;
done: pali_slh_erase(bytes, sizeof(bytes)); return result;
}
JNIEXPORT jbyteArray JNICALL Java_expo_modules_paliwalletcrypto_PaliSlhNative_prelude(
    JNIEnv *env, jclass type, jbyteArray key, jbyteArray action, jbyteArray random) {
  (void)type; uint8_t secret[64] = {0}, hash[32] = {0}, optrand[16] = {0}, output[46] = {0}; jbyteArray result = NULL;
  if (copy_bytes(env,key,secret,64) && copy_bytes(env,action,hash,32) && copy_bytes(env,random,optrand,16) &&
      pali_slh_prelude(secret,64,hash,32,optrand,16,output,46) == PALI_SLH_OK) {
    result=(*env)->NewByteArray(env,46); if(result) (*env)->SetByteArrayRegion(env,result,0,46,(const jbyte *)output);
  }
  pali_slh_erase(secret,64);pali_slh_erase(hash,32);pali_slh_erase(optrand,16);pali_slh_erase(output,46);return (*env)->ExceptionCheck(env)?NULL:result;
}
JNIEXPORT jbyteArray JNICALL Java_expo_modules_paliwalletcrypto_PaliSlhNative_fors(
    JNIEnv *env,jclass type,jbyteArray key,jbyteArray prefix,jint index) {
  (void)type;uint8_t secret[64]={0},prelude[46]={0},output[416]={0};jbyteArray result=NULL;
  if(index>=0&&index<6&&copy_bytes(env,key,secret,64)&&copy_bytes(env,prefix,prelude,46)&&pali_slh_fors_tree(secret,64,prelude,46,(uint32_t)index,output,416)==PALI_SLH_OK){
    result=(*env)->NewByteArray(env,416);if(result)(*env)->SetByteArrayRegion(env,result,0,416,(const jbyte *)output);
  }
  pali_slh_erase(secret,64);pali_slh_erase(prelude,46);pali_slh_erase(output,416);return (*env)->ExceptionCheck(env)?NULL:result;
}
JNIEXPORT jbyteArray JNICALL Java_expo_modules_paliwalletcrypto_PaliSlhNative_cached(
    JNIEnv *env,jclass type,jbyteArray key,jbyteArray action,jbyteArray random,jint fd,jobject owner) {
  (void)type;uint8_t secret[64]={0},hash[32]={0},optrand[16]={0},output[3856]={0};jbyteArray result=NULL;void *tree=MAP_FAILED;
  if(!copy_bytes(env,key,secret,64)||!copy_bytes(env,action,hash,32)||!copy_bytes(env,random,optrand,16))goto done;
  tree=tree_map(fd,0);if(tree==MAP_FAILED)goto done;
  if(pali_slh_sign_cached(secret,64,hash,32,optrand,16,tree,PALI_SLH_XMSS_TREE_BYTES,output,3856)==PALI_SLH_OK){
    result=(*env)->NewByteArray(env,3856);if(result)(*env)->SetByteArrayRegion(env,result,0,3856,(const jbyte *)output);
  }
done:if(tree!=MAP_FAILED&&!release_map(env,tree,owner))result=NULL;
  pali_slh_erase(secret,64);pali_slh_erase(hash,32);pali_slh_erase(optrand,16);pali_slh_erase(output,3856);return (*env)->ExceptionCheck(env)?NULL:result;
}
JNIEXPORT jbyteArray JNICALL Java_expo_modules_paliwalletcrypto_PaliSlhNative_finish(
    JNIEnv *env,jclass type,jbyteArray key,jbyteArray action,jbyteArray prefix,jbyteArray shards,jbyteArray roots,jint fd,jobject owner) {
  (void)type;uint8_t secret[64]={0},hash[32]={0},prelude[46]={0},fors[2400]={0},public_roots[96]={0},output[3856]={0};jbyteArray result=NULL;void *tree=MAP_FAILED;
  if(!copy_bytes(env,key,secret,64)||!copy_bytes(env,action,hash,32)||!copy_bytes(env,prefix,prelude,46)||!copy_bytes(env,shards,fors,2400)||!copy_bytes(env,roots,public_roots,96))goto done;
  tree=tree_map(fd,0);if(tree==MAP_FAILED)goto done;
  if(pali_slh_finish(secret,64,hash,32,prelude,46,fors,2400,public_roots,96,tree,PALI_SLH_XMSS_TREE_BYTES,output,3856)==PALI_SLH_OK){
    result=(*env)->NewByteArray(env,3856);if(result)(*env)->SetByteArrayRegion(env,result,0,3856,(const jbyte *)output);
  }
done:if(tree!=MAP_FAILED&&!release_map(env,tree,owner))result=NULL;
  pali_slh_erase(secret,64);pali_slh_erase(hash,32);pali_slh_erase(prelude,46);pali_slh_erase(fors,2400);pali_slh_erase(public_roots,96);pali_slh_erase(output,3856);return (*env)->ExceptionCheck(env)?NULL:result;
}
JNIEXPORT jint JNICALL Java_expo_modules_paliwalletcrypto_PaliSlhNative_verify(
    JNIEnv *env, jclass type, jbyteArray key, jbyteArray action, jbyteArray signature) {
  (void)type;
  uint8_t public_key[32] = {0}, hash[32] = {0}, bytes[3856] = {0};
  int result = -1;
  if (copy_bytes(env, key, public_key, 32) && copy_bytes(env, action, hash, 32) && copy_bytes(env, signature, bytes, 3856)) {
    const enum pali_slh_status status = pali_slh_verify(public_key, 32, hash, 32, bytes, 3856);
    if (status == PALI_SLH_OK) result = 1;
    else if (status == PALI_SLH_INVALID_SIGNATURE) result = 0;
  }
  pali_slh_erase(public_key, 32); pali_slh_erase(hash, 32); pali_slh_erase(bytes, 3856);
  return (*env)->ExceptionCheck(env) ? -1 : result;
}
