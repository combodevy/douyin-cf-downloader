/**
 * RC4 流加密算法
 * 对应 Python CryptoUtility.rc4_encrypt
 */
export function rc4Encrypt(key: Uint8Array | string, plaintext: Uint8Array | string): Uint8Array {
  const keyBytes =
    typeof key === "string" ? new TextEncoder().encode(key) : key;
  const dataBytes =
    typeof plaintext === "string"
      ? new TextEncoder().encode(plaintext)
      : plaintext;
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + keyBytes[i % keyBytes.length]) % 256;
    [S[i], S[j]] = [S[j], S[i]];
  }
  const out = new Uint8Array(dataBytes.length);
  let i = 0;
  j = 0;
  for (let idx = 0; idx < dataBytes.length; idx++) {
    i = (i + 1) % 256;
    j = (j + S[i]) % 256;
    [S[i], S[j]] = [S[j], S[i]];
    const k = S[(S[i] + S[j]) % 256];
    out[idx] = dataBytes[idx] ^ k;
  }
  return out;
}
export function rc4EncryptToString(
  key: Uint8Array | string,
  plaintext: Uint8Array | string
): string {
  const bytes = rc4Encrypt(key, plaintext);
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return str;
}
