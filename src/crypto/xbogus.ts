/**
 * X-Bogus 签名算法（转译自 Python utils/xbogus.py — Evil0ctal 经典版本）
 * 抖音上一代签名，作为 a_bogus 失败时的回退
 */
import { md5 } from "./md5";
import { rc4Encrypt } from "./rc4";

const CHARACTER =
  "Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=";

const HEX_MAP: number[] = new Array(256).fill(0);
"0123456789".split("").forEach((c, i) => { HEX_MAP[c.charCodeAt(0)] = i; });
"abcdef".split("").forEach((c, i) => { HEX_MAP[c.charCodeAt(0)] = 10 + i; });
"ABCDEF".split("").forEach((c, i) => { HEX_MAP[c.charCodeAt(0)] = 10 + i; });

function md5StrToArray(md5Str: string): number[] {
  if (md5Str.length > 32) {
    return Array.from(md5Str).map((c) => c.charCodeAt(0));
  }
  const arr: number[] = [];
  for (let i = 0; i < md5Str.length; i += 2) {
    const hi = HEX_MAP[md5Str.charCodeAt(i)];
    const lo = HEX_MAP[md5Str.charCodeAt(i + 1)];
    arr.push((hi << 4) | lo);
  }
  return arr;
}

function md5Encrypt(urlPath: string): number[] {
  const firstHex = md5(urlPath);
  const firstBytes = md5StrToArray(firstHex);
  const secondHex = md5(new Uint8Array(firstBytes));
  return md5StrToArray(secondHex);
}

function encodingConversion(
  a: number, b: number, c: number, e: number, d: number,
  t: number, f: number, r: number, n: number, o: number,
  i: number, underscore: number, x: number, u: number, s: number,
  l: number, v: number, h: number, p: number
): string {
  const payload = [a, i, b, underscore, c, x, e, u, d, s, t, l, f, v, r, h, n, p, o];
  return String.fromCharCode(...payload);
}

function calculation(a1: number, a2: number, a3: number): string {
  const x3 = ((a1 & 255) << 16) | ((a2 & 255) << 8) | (a3 & 255);
  return (
    CHARACTER[(x3 & 0xfc0000) >> 18] +
    CHARACTER[(x3 & 0x03f000) >> 12] +
    CHARACTER[(x3 & 0x000fc0) >> 6] +
    CHARACTER[x3 & 0x3f]
  );
}

export interface XBogusResult {
  signedUrl: string;
  xbogus: string;
  userAgent: string;
}

export class XBogus {
  private userAgent: string;
  private uaKey = new Uint8Array([0x00, 0x01, 0x0c]);

  constructor(userAgent: string = "") {
    this.userAgent =
      userAgent ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
  }

  build(url: string): XBogusResult {
    const uaRc4 = rc4Encrypt(this.uaKey, this.userAgent);
    const uaB64 = btoa(Array.from(uaRc4).map((b) => String.fromCharCode(b)).join(""));
    const uaMd5Array = md5StrToArray(md5(uaB64));

    const emptyBytes = md5StrToArray("d41d8cd98f00b204e9800998ecf8427e");
    const emptyMd5Array = md5StrToArray(md5(new Uint8Array(emptyBytes)));

    const urlMd5Array = md5Encrypt(url);

    const timer = Math.floor(Date.now() / 1000);
    const ct = 536919696;
    const newArray: number[] = [
      64, 0.00390625, 1, 12,
      urlMd5Array[14], urlMd5Array[15],
      emptyMd5Array[14], emptyMd5Array[15],
      uaMd5Array[14], uaMd5Array[15],
      (timer >> 24) & 255, (timer >> 16) & 255, (timer >> 8) & 255, timer & 255,
      (ct >> 24) & 255, (ct >> 16) & 255, (ct >> 8) & 255, ct & 255,
    ];

    let xorResult = newArray[0];
    for (let i = 1; i < newArray.length; i++) {
      const v = Number.isInteger(newArray[i]) ? newArray[i] : Math.floor(newArray[i]);
      xorResult ^= v;
    }
    newArray.push(xorResult);

    const array3: number[] = [];
    const array4: number[] = [];
    for (let idx = 0; idx < newArray.length; idx += 2) {
      array3.push(newArray[idx]);
      if (idx + 1 < newArray.length) {
        array4.push(newArray[idx + 1]);
      }
    }
    const merged = [...array3, ...array4];

    const encoded = encodingConversion(
      merged[0], merged[1], merged[2], merged[3], merged[4],
      merged[5], merged[6], merged[7], merged[8], merged[9],
      merged[10], merged[11], merged[12], merged[13], merged[14],
      merged[15], merged[16], merged[17], merged[18]
    );
    const rc4Key = new Uint8Array([0xff]);
    const rc4Result = rc4Encrypt(rc4Key, encoded);
    const garbled =
      String.fromCharCode(2) +
      String.fromCharCode(255) +
      Array.from(rc4Result).map((b) => String.fromCharCode(b)).join("");

    let xb = "";
    for (let idx = 0; idx < garbled.length; idx += 3) {
      xb += calculation(
        garbled.charCodeAt(idx),
        garbled.charCodeAt(idx + 1),
        garbled.charCodeAt(idx + 2)
      );
    }

    return {
      signedUrl: `${url}&X-Bogus=${xb}`,
      xbogus: xb,
      userAgent: this.userAgent,
    };
  }
}
