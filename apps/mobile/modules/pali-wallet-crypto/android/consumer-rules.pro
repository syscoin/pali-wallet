-keep class expo.modules.paliwalletcrypto.PaliPublicMerkleNative {
  public static native byte[] execute(byte[]);
}

-keep class expo.modules.paliwalletcrypto.PaliSlhNative {
  public static native byte[] publicFixtureSeed();
  public static native byte[] leafChunk(byte[], int, int);
}
