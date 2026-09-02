/**
 * MD5 哈希（Web Crypto API 不支持 MD5，自行实现）
 * 对应 Python hashlib.md5
 */
function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const K = new Int32Array(64);
for (let i = 0; i < 64; i++) {
  K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);
}
function add32(a: number, b: number): number {
  return (a + b) >>> 0;
}
export function md5(input: Uint8Array | string): string {
  const data =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  const origLen = data.length;
  const bitLen = origLen * 8;
  const padLen = ((56 - (origLen + 1) % 64) + 64) % 64;
  const total = origLen + 1 + padLen + 8;
  const msg = new Uint8Array(total);
  msg.set(data, 0);
  msg[origLen] = 0x80;
  const lo = bitLen >>> 0;
  const hi = Math.floor(bitLen / 0x100000000);
  const dv = new DataView(msg.buffer);
  dv.setUint32(total - 8, lo, true);
  dv.setUint32(total - 4, hi, true);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let offset = 0; offset < total; offset += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
      M[i] = dv.getUint32(offset + i * 4, true);
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = add32(F, add32(A, add32(K[i], M[g])));
      A = D;
      D = C;
      C = B;
      B = add32(B, rotl(F, S[i]));
    }
    a0 = add32(a0, A);
    b0 = add32(b0, B);
    c0 = add32(c0, C);
    d0 = add32(d0, D);
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true);
  odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true);
  odv.setUint32(12, d0, true);
  return Array.from(out)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
/** 对应 Python _md5_str_to_array：十六进制字符串转字节数组 */
export function md5StrToArray(md5Str: string): number[] {
  if (md5Str.length > 32) {
    return Array.from(md5Str).map((c) => c.charCodeAt(0));
  }
  const arr: number[] = [];
  // 对应 Python 的 hex 解码：每两个十六进制字符 → 一个字节
  // 但原项目用的是自定义 array 映射（base64-like），这里直接按 hex 解码
  for (let i = 0; i < md5Str.length; i += 2) {
    arr.push(parseInt(md5Str.substring(i, i + 2), 16));
  }
  return arr;
}
