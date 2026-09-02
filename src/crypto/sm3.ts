/**
 * SM3 国密哈希算法 (GB/T 32905-2016)
 * 对应 Python gmssl 库的 sm3.sm3_hash 函数
 * 输出 64 字符十六进制字符串
 */
const IV: number[] = [
  0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600,
  0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e,
];
const T1 = 0x79cc4519;
const T2 = 0x7a879d8a;
function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}
function ff(j: number, x: number, y: number, z: number): number {
  if (j < 16) return (x ^ y ^ z) >>> 0;
  return ((x & y) | (x & z) | (y & z)) >>> 0;
}
function gg(j: number, x: number, y: number, z: number): number {
  if (j < 16) return (x ^ y ^ z) >>> 0;
  return ((x & y) | (~x & z)) >>> 0;
}
function p0(x: number): number {
  return (x ^ rotl(x, 9) ^ rotl(x, 17)) >>> 0;
}
function p1(x: number): number {
  return (x ^ rotl(x, 15) ^ rotl(x, 23)) >>> 0;
}
function t(j: number): number {
  return j < 16 ? T1 : T2;
}
function cf(v: number[], block: Uint8Array): number[] {
  const w: number[] = new Array(68);
  for (let i = 0; i < 16; i++) {
    w[i] =
      ((block[i * 4] << 24) |
        (block[i * 4 + 1] << 16) |
        (block[i * 4 + 2] << 8) |
        block[i * 4 + 3]) >>>
      0;
  }
  for (let j = 16; j < 68; j++) {
    w[j] =
      (p1(w[j - 16] ^ w[j - 9] ^ rotl(w[j - 3], 15)) ^
        rotl(w[j - 13], 7) ^
        w[j - 6]) >>>
      0;
  }
  const w1: number[] = new Array(64);
  for (let j = 0; j < 64; j++) {
    w1[j] = (w[j] ^ w[j + 4]) >>> 0;
  }
  let [a, b, c, d, e, f, g, h] = v;
  for (let j = 0; j < 64; j++) {
    const ss1 = rotl(
      ((rotl(a, 12) + e + rotl(t(j), j)) >>> 0) >>> 0,
      7
    );
    const ss2 = (ss1 ^ rotl(a, 12)) >>> 0;
    const tt1 = (ff(j, a, b, c) + d + ss2 + w1[j]) >>> 0;
    const tt2 = (gg(j, e, f, g) + h + ss1 + w[j]) >>> 0;
    d = c;
    c = rotl(b, 9);
    b = a;
    a = tt1;
    h = g;
    g = rotl(f, 19);
    f = e;
    e = p0(tt2);
  }
  return [
    (v[0] ^ a) >>> 0,
    (v[1] ^ b) >>> 0,
    (v[2] ^ c) >>> 0,
    (v[3] ^ d) >>> 0,
    (v[4] ^ e) >>> 0,
    (v[5] ^ f) >>> 0,
    (v[6] ^ g) >>> 0,
    (v[7] ^ h) >>> 0,
  ];
}
function pad(msg: Uint8Array): Uint8Array {
  const len = msg.length;
  const bitLen = len * 8;
  const padLen = ((56 - (len + 1) % 64) + 64) % 64;
  const total = len + 1 + padLen + 8;
  const out = new Uint8Array(total);
  out.set(msg, 0);
  out[len] = 0x80;
  // 64-bit big-endian length
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  out[total - 8] = (hi >>> 24) & 0xff;
  out[total - 7] = (hi >>> 16) & 0xff;
  out[total - 6] = (hi >>> 8) & 0xff;
  out[total - 5] = hi & 0xff;
  out[total - 4] = (lo >>> 24) & 0xff;
  out[total - 3] = (lo >>> 16) & 0xff;
  out[total - 2] = (lo >>> 8) & 0xff;
  out[total - 1] = lo & 0xff;
  return out;
}
export function sm3(input: Uint8Array | string): string {
  const data =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  const padded = pad(data);
  let v = [...IV];
  for (let i = 0; i < padded.length; i += 64) {
    v = cf(v, padded.subarray(i, i + 64));
  }
  return v.map((x) => x.toString(16).padStart(8, "0")).join("");
}
/** 对应 Python 的 sm3_to_array：返回 32 字节整数数组 */
export function sm3ToArray(input: Uint8Array | string): number[] {
  const hex = sm3(input);
  const arr: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    arr.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return arr;
}
