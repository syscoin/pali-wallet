cmake_minimum_required(VERSION 3.22)
project(pali_public_mimc LANGUAGES C)

add_library(pali_public_mimc SHARED
  PaliPublicMerkleJni.c
  ../../../../shared/mimc_batch.c
)

set(SLH_DIRECTORY ../../../../shared/slh)
add_library(pali_slh_engine SHARED
  PaliSlhJni.c
  ${SLH_DIRECTORY}/pali_slh_native.c
  ${SLH_DIRECTORY}/strict_rng.c
  ${SLH_DIRECTORY}/pali_slh_secure_clear.c
  ${SLH_DIRECTORY}/slhdsa_emscripten_wrapper.c
  ${SLH_DIRECTORY}/address.c
  ${SLH_DIRECTORY}/fors.c
  ${SLH_DIRECTORY}/hash_sha2.c
  ${SLH_DIRECTORY}/merkle.c
  ${SLH_DIRECTORY}/sha2.c
  ${SLH_DIRECTORY}/sign.c
  ${SLH_DIRECTORY}/utils.c
  ${SLH_DIRECTORY}/utilsx1.c
  ${SLH_DIRECTORY}/wots.c
  ${SLH_DIRECTORY}/wotsx1.c
  ${SLH_DIRECTORY}/thash_sha2_simple.c
)
target_include_directories(pali_slh_engine PRIVATE ${SLH_DIRECTORY})

foreach(target IN ITEMS pali_public_mimc pali_slh_engine)
  set_target_properties(${target} PROPERTIES C_STANDARD 11 C_STANDARD_REQUIRED ON)
  target_compile_options(${target} PRIVATE -Wall -Wextra -Werror -fvisibility=hidden)
  # The pinned r27 NDK needs explicit 16 KB ELF alignment.
  target_link_options(${target} PRIVATE "-Wl,-z,max-page-size=16384" "-Wl,-z,common-page-size=16384")
endforeach()
