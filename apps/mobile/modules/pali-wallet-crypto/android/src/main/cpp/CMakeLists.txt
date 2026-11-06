cmake_minimum_required(VERSION 3.22)
project(pali_public_mimc LANGUAGES C)

add_library(pali_public_mimc SHARED
  PaliPublicMerkleJni.c
  ../../../../shared/mimc_batch.c
)
set_target_properties(pali_public_mimc PROPERTIES C_STANDARD 11 C_STANDARD_REQUIRED ON)
target_compile_options(pali_public_mimc PRIVATE -Wall -Wextra -Werror -fvisibility=hidden)
