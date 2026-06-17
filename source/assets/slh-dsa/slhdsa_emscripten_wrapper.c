// SPDX-License-Identifier: MIT
//
// Browser wrapper for nconsigny/SPHINCS- signers/sphincsplus-128-24.
// Build this together with the upstream C files, excluding main.c.

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "address.h"
#include "api.h"
#include "fors.h"
#include "hash.h"
#include "params.h"
#include "thash.h"
#include "utilsx1.h"
#include "wots.h"
#include "wotsx1.h"

extern void set_rng_buffer(const unsigned char *buf, unsigned long long len);

#define SLH_DSA_XMSS_TREE_BYTES (((1 << (SPX_FULL_HEIGHT + 1)) - 1) * SPX_N)
#define SLH_DSA_PRELUDE_BYTES (SPX_N + SPX_FORS_MSG_BYTES + 8 + 4)
#define SLH_DSA_FORS_TREE_SIG_BYTES ((SPX_FORS_HEIGHT + 1) * SPX_N)
#define SLH_DSA_FORS_TREE_OUTPUT_BYTES (SLH_DSA_FORS_TREE_SIG_BYTES + SPX_N)

struct wrapper_fors_gen_leaf_info {
  uint32_t leaf_addrx[8];
};

static size_t xmss_level_offset(unsigned int level) {
  size_t offset = 0;
  for (unsigned int h = 0; h < level; h++) {
    offset += ((size_t)1 << (SPX_FULL_HEIGHT - h)) * SPX_N;
  }
  return offset;
}

static void init_ctx_from_sk(spx_ctx *ctx, const uint8_t *sk64) {
  memcpy(ctx->sk_seed, sk64, SPX_N);
  memcpy(ctx->pub_seed, sk64 + 2 * SPX_N, SPX_N);
  initialize_hash_function(ctx);
}

static void init_ctx_from_fors_context(spx_ctx *ctx, const uint8_t *fors_context32) {
  memcpy(ctx->sk_seed, fors_context32, SPX_N);
  memcpy(ctx->pub_seed, fors_context32 + SPX_N, SPX_N);
  initialize_hash_function(ctx);
}

static void init_ctx_from_seed48(spx_ctx *ctx, const uint8_t *seed48) {
  memcpy(ctx->sk_seed, seed48, SPX_N);
  memcpy(ctx->pub_seed, seed48 + 2 * SPX_N, SPX_N);
  initialize_hash_function(ctx);
}

static void write_u64_be(uint8_t *out, uint64_t value) {
  for (unsigned int i = 0; i < 8; i++) {
    out[i] = (uint8_t)(value >> (56 - 8 * i));
  }
}

static uint64_t read_u64_be(const uint8_t *in) {
  uint64_t value = 0;
  for (unsigned int i = 0; i < 8; i++) {
    value = (value << 8) | in[i];
  }
  return value;
}

static void write_u32_be(uint8_t *out, uint32_t value) {
  out[0] = (uint8_t)(value >> 24);
  out[1] = (uint8_t)(value >> 16);
  out[2] = (uint8_t)(value >> 8);
  out[3] = (uint8_t)value;
}

static uint32_t read_u32_be(const uint8_t *in) {
  return ((uint32_t)in[0] << 24) |
    ((uint32_t)in[1] << 16) |
    ((uint32_t)in[2] << 8) |
    (uint32_t)in[3];
}

static void wrapper_message_to_indices(uint32_t *indices, const unsigned char *m) {
  unsigned int offset = 0;
  for (unsigned int i = 0; i < SPX_FORS_TREES; i++) {
    indices[i] = 0;
    for (unsigned int j = 0; j < SPX_FORS_HEIGHT; j++) {
      indices[i] = (indices[i] << 1) |
        ((m[offset >> 3] >> (7 - (offset & 0x7))) & 1u);
      offset++;
    }
  }
}

static void wrapper_fors_gen_sk(
  unsigned char *sk,
  const spx_ctx *ctx,
  uint32_t fors_leaf_addr[8]
) {
  prf_addr(sk, ctx, fors_leaf_addr);
}

static void wrapper_fors_sk_to_leaf(
  unsigned char *leaf,
  const unsigned char *sk,
  const spx_ctx *ctx,
  uint32_t fors_leaf_addr[8]
) {
  thash(leaf, sk, 1, ctx, fors_leaf_addr);
}

static void wrapper_fors_gen_leafx1(
  unsigned char *leaf,
  const spx_ctx *ctx,
  uint32_t addr_idx,
  void *info
) {
  struct wrapper_fors_gen_leaf_info *fors_info = info;
  uint32_t *fors_leaf_addr = fors_info->leaf_addrx;

  set_tree_index(fors_leaf_addr, addr_idx);
  set_type(fors_leaf_addr, SPX_ADDR_TYPE_FORSPRF);
  wrapper_fors_gen_sk(leaf, ctx, fors_leaf_addr);

  set_type(fors_leaf_addr, SPX_ADDR_TYPE_FORSTREE);
  wrapper_fors_sk_to_leaf(leaf, leaf, ctx, fors_leaf_addr);
}

int slh_dsa_build_xmss_tree_chunk(
  const uint8_t *seed48,
  uint8_t *out_tree,
  uint32_t level,
  uint32_t start,
  uint32_t count
) {
  spx_ctx ctx;
  uint32_t tree_addr[8] = {0};
  uint32_t wots_addr[8] = {0};
  uint32_t leaf_addr[8] = {0};
  uint32_t pk_addr[8] = {0};
  unsigned int zero_steps[SPX_WOTS_LEN] = {0};
  struct leaf_info_x1 info = {0};

  if (level > SPX_FULL_HEIGHT) {
    return -1;
  }

  const uint32_t level_nodes = (uint32_t)1 << (SPX_FULL_HEIGHT - level);
  if (start > level_nodes) {
    return -1;
  }
  if (count > level_nodes - start) {
    count = level_nodes - start;
  }

  init_ctx_from_seed48(&ctx, seed48);

  if (level == 0) {
    set_layer_addr(wots_addr, SPX_D - 1);
    set_tree_addr(wots_addr, 0);
    copy_subtree_addr(leaf_addr, wots_addr);
    copy_subtree_addr(pk_addr, wots_addr);
    set_type(pk_addr, SPX_ADDR_TYPE_WOTSPK);

    memcpy(info.leaf_addr, leaf_addr, sizeof(info.leaf_addr));
    memcpy(info.pk_addr, pk_addr, sizeof(info.pk_addr));
    info.wots_steps = zero_steps;
    info.wots_sign_leaf = (uint32_t)~0;

    const size_t level_offset = 0;
    for (uint32_t idx = start; idx < start + count; idx++) {
      wots_gen_leafx1(out_tree + level_offset + (size_t)idx * SPX_N, &ctx, idx, &info);
    }
    return (int)count;
  }

  set_layer_addr(tree_addr, SPX_D - 1);
  set_tree_addr(tree_addr, 0);
  set_type(tree_addr, SPX_ADDR_TYPE_HASHTREE);
  set_tree_height(tree_addr, level);

  const size_t child_offset = xmss_level_offset(level - 1);
  const size_t level_offset = xmss_level_offset(level);
  for (uint32_t idx = start; idx < start + count; idx++) {
    set_tree_index(tree_addr, idx);
    thash(
      out_tree + level_offset + (size_t)idx * SPX_N,
      out_tree + child_offset + (size_t)idx * 2 * SPX_N,
      2,
      &ctx,
      tree_addr
    );
  }

  return (int)count;
}

int slh_dsa_build_xmss_leaf_chunk(
  const uint8_t *seed48,
  uint8_t *out_leaves,
  uint32_t start,
  uint32_t count
) {
  spx_ctx ctx;
  uint32_t wots_addr[8] = {0};
  uint32_t leaf_addr[8] = {0};
  uint32_t pk_addr[8] = {0};
  unsigned int zero_steps[SPX_WOTS_LEN] = {0};
  struct leaf_info_x1 info = {0};
  const uint32_t leaf_count = (uint32_t)1 << SPX_FULL_HEIGHT;

  if (start > leaf_count) {
    return -1;
  }
  if (count > leaf_count - start) {
    count = leaf_count - start;
  }

  init_ctx_from_seed48(&ctx, seed48);

  set_layer_addr(wots_addr, SPX_D - 1);
  set_tree_addr(wots_addr, 0);
  copy_subtree_addr(leaf_addr, wots_addr);
  copy_subtree_addr(pk_addr, wots_addr);
  set_type(pk_addr, SPX_ADDR_TYPE_WOTSPK);

  memcpy(info.leaf_addr, leaf_addr, sizeof(info.leaf_addr));
  memcpy(info.pk_addr, pk_addr, sizeof(info.pk_addr));
  info.wots_steps = zero_steps;
  info.wots_sign_leaf = (uint32_t)~0;

  for (uint32_t idx = 0; idx < count; idx++) {
    wots_gen_leafx1(out_leaves + (size_t)idx * SPX_N, &ctx, start + idx, &info);
  }

  return (int)count;
}

int slh_dsa_sign_prelude(
  const uint8_t *sk64,
  const uint8_t *message,
  size_t message_len,
  const uint8_t *optrand16,
  uint8_t *out_prelude
) {
  spx_ctx ctx;
  const unsigned char *sk_prf = sk64 + SPX_N;
  const unsigned char *pk = sk64 + 2 * SPX_N;
  uint64_t tree;
  uint32_t idx_leaf;

  init_ctx_from_sk(&ctx, sk64);
  set_rng_buffer(optrand16, SPX_N);
  gen_message_random(out_prelude, sk_prf, optrand16, message, message_len, &ctx);
  hash_message(
    out_prelude + SPX_N,
    &tree,
    &idx_leaf,
    out_prelude,
    pk,
    message,
    message_len,
    &ctx
  );
  write_u64_be(out_prelude + SPX_N + SPX_FORS_MSG_BYTES, tree);
  write_u32_be(out_prelude + SPX_N + SPX_FORS_MSG_BYTES + 8, idx_leaf);

  return SLH_DSA_PRELUDE_BYTES;
}

int slh_dsa_sign_fors_tree(
  const uint8_t *fors_context32,
  const uint8_t *prelude,
  uint32_t tree_index,
  uint8_t *out416
) {
  spx_ctx ctx;
  uint32_t indices[SPX_FORS_TREES];
  uint32_t fors_tree_addr[8] = {0};
  struct wrapper_fors_gen_leaf_info fors_info = {0};
  uint32_t *fors_leaf_addr = fors_info.leaf_addrx;
  uint32_t idx_offset;

  if (tree_index >= SPX_FORS_TREES) {
    return -1;
  }

  init_ctx_from_fors_context(&ctx, fors_context32);
  wrapper_message_to_indices(indices, prelude + SPX_N);

  uint64_t tree = read_u64_be(prelude + SPX_N + SPX_FORS_MSG_BYTES);
  uint32_t idx_leaf = read_u32_be(prelude + SPX_N + SPX_FORS_MSG_BYTES + 8);
  uint32_t fors_addr[8] = {0};
  set_type(fors_addr, SPX_ADDR_TYPE_WOTS);
  set_tree_addr(fors_addr, tree);
  set_keypair_addr(fors_addr, idx_leaf);

  copy_keypair_addr(fors_tree_addr, fors_addr);
  copy_keypair_addr(fors_leaf_addr, fors_addr);

  idx_offset = tree_index * (1 << SPX_FORS_HEIGHT);

  set_tree_height(fors_tree_addr, 0);
  set_tree_index(fors_tree_addr, indices[tree_index] + idx_offset);
  set_type(fors_tree_addr, SPX_ADDR_TYPE_FORSPRF);

  wrapper_fors_gen_sk(out416, &ctx, fors_tree_addr);
  set_type(fors_tree_addr, SPX_ADDR_TYPE_FORSTREE);

  treehashx1(
    out416 + SLH_DSA_FORS_TREE_SIG_BYTES,
    out416 + SPX_N,
    &ctx,
    indices[tree_index],
    idx_offset,
    SPX_FORS_HEIGHT,
    wrapper_fors_gen_leafx1,
    fors_tree_addr,
    &fors_info
  );

  return SLH_DSA_FORS_TREE_OUTPUT_BYTES;
}

int slh_dsa_finish_signature_with_fors_and_xmss_tree(
  const uint8_t *sk64,
  const uint8_t *prelude,
  const uint8_t *fors_sig,
  const uint8_t *fors_roots,
  const uint8_t *xmss_tree,
  uint8_t *out3856
) {
  spx_ctx ctx;
  const unsigned char *pk = sk64 + 2 * SPX_N;
  unsigned char root[SPX_N];
  uint32_t wots_addr[8] = {0};
  uint32_t tree_addr[8] = {0};
  uint32_t fors_pk_addr[8] = {0};
  unsigned steps[SPX_WOTS_LEN];
  struct leaf_info_x1 info = {0};
  unsigned char leaf[SPX_N];
  uint8_t *sig = out3856;

  if (memcmp(xmss_tree + xmss_level_offset(SPX_FULL_HEIGHT), sk64 + 3 * SPX_N, SPX_N) != 0) {
    return -1;
  }

  init_ctx_from_sk(&ctx, sk64);

  uint64_t tree = read_u64_be(prelude + SPX_N + SPX_FORS_MSG_BYTES);
  uint32_t idx_leaf = read_u32_be(prelude + SPX_N + SPX_FORS_MSG_BYTES + 8);

  memcpy(sig, prelude, SPX_N);
  sig += SPX_N;
  memcpy(sig, fors_sig, SPX_FORS_BYTES);
  sig += SPX_FORS_BYTES;

  set_type(wots_addr, SPX_ADDR_TYPE_WOTS);
  set_tree_addr(wots_addr, tree);
  set_keypair_addr(wots_addr, idx_leaf);

  copy_keypair_addr(fors_pk_addr, wots_addr);
  set_type(fors_pk_addr, SPX_ADDR_TYPE_FORSPK);
  thash(root, fors_roots, SPX_FORS_TREES, &ctx, fors_pk_addr);

  set_type(tree_addr, SPX_ADDR_TYPE_HASHTREE);
  set_layer_addr(tree_addr, SPX_D - 1);
  set_tree_addr(tree_addr, tree);
  copy_subtree_addr(wots_addr, tree_addr);
  set_keypair_addr(wots_addr, idx_leaf);

  info.wots_sig = sig;
  chain_lengths(steps, root);
  info.wots_steps = steps;
  set_type(&info.pk_addr[0], SPX_ADDR_TYPE_WOTSPK);
  copy_subtree_addr(&info.leaf_addr[0], wots_addr);
  copy_subtree_addr(&info.pk_addr[0], wots_addr);
  info.wots_sign_leaf = idx_leaf;
  wots_gen_leafx1(leaf, &ctx, idx_leaf, &info);
  sig += SPX_WOTS_BYTES;

  for (unsigned int level = 0; level < SPX_FULL_HEIGHT; level++) {
    uint32_t sibling = (idx_leaf >> level) ^ 1;
    memcpy(
      sig + level * SPX_N,
      xmss_tree + xmss_level_offset(level) + (size_t)sibling * SPX_N,
      SPX_N
    );
  }

  (void)pk;
  return SPX_BYTES;
}

int slh_dsa_sign_action_hash_with_sk_and_xmss_tree(
  const uint8_t *sk64,
  const uint8_t *message,
  size_t message_len,
  const uint8_t *optrand16,
  const uint8_t *xmss_tree,
  uint8_t *out3856
) {
  spx_ctx ctx;
  const unsigned char *sk_prf = sk64 + SPX_N;
  const unsigned char *pk = sk64 + 2 * SPX_N;
  unsigned char mhash[SPX_FORS_MSG_BYTES];
  unsigned char root[SPX_N];
  uint64_t tree;
  uint32_t idx_leaf;
  uint32_t wots_addr[8] = {0};
  uint32_t tree_addr[8] = {0};
  unsigned steps[SPX_WOTS_LEN];
  struct leaf_info_x1 info = {0};
  unsigned char leaf[SPX_N];
  uint8_t *sig = out3856;

  if (memcmp(xmss_tree + xmss_level_offset(SPX_FULL_HEIGHT), sk64 + 3 * SPX_N, SPX_N) != 0) {
    return -1;
  }

  init_ctx_from_sk(&ctx, sk64);
  set_type(wots_addr, SPX_ADDR_TYPE_WOTS);
  set_type(tree_addr, SPX_ADDR_TYPE_HASHTREE);

  set_rng_buffer(optrand16, SPX_N);
  gen_message_random(sig, sk_prf, optrand16, message, message_len, &ctx);
  hash_message(mhash, &tree, &idx_leaf, sig, pk, message, message_len, &ctx);
  sig += SPX_N;

  set_tree_addr(wots_addr, tree);
  set_keypair_addr(wots_addr, idx_leaf);
  fors_sign(sig, root, mhash, &ctx, wots_addr);
  sig += SPX_FORS_BYTES;

  set_layer_addr(tree_addr, SPX_D - 1);
  set_tree_addr(tree_addr, tree);
  copy_subtree_addr(wots_addr, tree_addr);
  set_keypair_addr(wots_addr, idx_leaf);

  info.wots_sig = sig;
  chain_lengths(steps, root);
  info.wots_steps = steps;
  set_type(&tree_addr[0], SPX_ADDR_TYPE_HASHTREE);
  set_type(&info.pk_addr[0], SPX_ADDR_TYPE_WOTSPK);
  copy_subtree_addr(&info.leaf_addr[0], wots_addr);
  copy_subtree_addr(&info.pk_addr[0], wots_addr);
  info.wots_sign_leaf = idx_leaf;
  wots_gen_leafx1(leaf, &ctx, idx_leaf, &info);
  sig += SPX_WOTS_BYTES;

  for (unsigned int level = 0; level < SPX_FULL_HEIGHT; level++) {
    uint32_t sibling = (idx_leaf >> level) ^ 1;
    memcpy(
      sig + level * SPX_N,
      xmss_tree + xmss_level_offset(level) + (size_t)sibling * SPX_N,
      SPX_N
    );
  }

  return SPX_BYTES;
}

