/**
 * X-Bogus 签名算法（转译自 Python utils/xbogus.py）
 *
 * 算法流程：
 * 1. 对 query+body+UA 做 MD5，取特定字节
 * 2. 构建 48 字节数据帧（时间戳、MD5 字节、options、aid）
 * 3. 按 sort_index 重排 + 链式异或校验
 * 4. RC4 加密
 * 5. 自定义 Base64 编码输出
 */
import { md5, md5StrToArray } from "./md5";
import { rc4Encrypt } from "./rc4";

const CHARACTER =
  "Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe";
const SORT_INDEX = [
  22, 4, 7, 25, 1, 32, 30, 24, 33, 16, 0, 11, 29, 19, 27, 35, 28, 34, 31, 10,
  15, 18, 3, 8, 5, 17, 2, 13, 12, 26, 9, 20, 21, 6, 23, 36,
];
const SORT_INDEX_2 = [
  22, 4, 7, 25, 1, 32, 30, 24, 33, 16, 0, 11, 29, 19, 27, 35, 28, 34, 31, 10,
  15, 18, 3, 8, 5, 17, 2, 13, 12, 26, 9, 20, 21, 6, 23, 36, 37,
];
const XB_KEY = new Uint8Array([0x00, 0x01, 0x0c]);

export interface XBogusResult {
  params: string;
  xbogus: string;
  userAgent: string;
}

export class XBogus {
  private aid = 6383;
  private options: number[];
  private userAgent: string;

  constructor(
    userAgent: string = "",
    options: number[] = [0, 1, 12]
  ) {
    this.options = options;
    this.userAgent =
      userAgent ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
  }

  private xbEncode(xbBytesStr: string): string {
    const xbogus: string[] = [];
    for (let i = 0; i < xbBytesStr.length; i += 3) {
      let n: number;
      if (i + 2 < xbBytesStr.length) {
        n =
          (xbBytesStr.charCodeAt(i) << 16) |
          (xbBytesStr.charCodeAt(i + 1) << 8) |
          xbBytesStr.charCodeAt(i + 2);
      } else if (i + 1 < xbBytesStr.length) {
        n =
          (xbBytesStr.charCodeAt(i) << 16) |
          (xbBytesStr.charCodeAt(i + 1) << 8);
      } else {
        n = xbBytesStr.charCodeAt(i) << 16;
      }
      const shifts = [18, 12, 6, 0];
      const masks = [0xfc0000, 0x03f000, 0x0fc0, 0x3f];
      for (let j = 0; j < 4; j++) {
        if (shifts[j] === 6 && i + 1 >= xbBytesStr.length) break;
        if (shifts[j] === 0 && i + 2 >= xbBytesStr.length) break;
        xbogus.push(CHARACTER[(n & masks[j]) >> shifts[j]]);
      }
    }
    const padCount = (4 - (xbogus.length % 4)) % 4;
    xbogus.push("=".repeat(padCount));
    return xbogus.join("");
  }

  generate(params: string, body: string = ""): XBogusResult {
    const xbDir = new Map<number, number>();
    xbDir.set(14, 2);
    xbDir.set(15, 255);
    xbDir.set(36, 0);
    xbDir.set(37, 0);

    const startEncryption = Date.now();

    const array1 = md5StrToArray(md5(params));
    const array2 = md5StrToArray(md5(body));

    const uaRc4 = rc4Encrypt(XB_KEY, this.userAgent);
    const uaB64 = btoa(
      Array.from(uaRc4).map((b) => String.fromCharCode(b)).join("")
    );
    const array3 = md5StrToArray(md5(uaB64));

    const endEncryption = Date.now();

    xbDir.set(16, (startEncryption >> 24) & 255);
    xbDir.set(17, (startEncryption >> 16) & 255);
    xbDir.set(18, (startEncryption >> 8) & 255);
    xbDir.set(19, startEncryption & 255);
    xbDir.set(20, Math.floor(startEncryption / 256 / 256 / 256 / 256) & 255);
    xbDir.set(21, Math.floor(startEncryption / 256 / 256 / 256 / 256 / 256) & 255);

    xbDir.set(22, (this.options[0] >> 24) & 255);
    xbDir.set(23, (this.options[0] >> 16) & 255);
    xbDir.set(24, (this.options[0] >> 8) & 255);
    xbDir.set(25, this.options[0] & 255);
    xbDir.set(26, Math.floor(this.options[1] / 256) & 255);
    xbDir.set(27, (this.options[1] % 256) & 255);
    xbDir.set(28, (this.options[1] >> 24) & 255);
    xbDir.set(29, (this.options[1] >> 16) & 255);
    xbDir.set(30, (this.options[2] >> 24) & 255);
    xbDir.set(31, (this.options[2] >> 16) & 255);
    xbDir.set(32, (this.options[2] >> 8) & 255);
    xbDir.set(33, this.options[2] & 255);

    xbDir.set(34, array1[14]);
    xbDir.set(35, array1[15]);
    xbDir.set(36, array2[14]);
    xbDir.set(37, array2[15]);
    xbDir.set(38, array3[14]);
    xbDir.set(39, array3[15]);

    xbDir.set(40, (endEncryption >> 24) & 255);
    xbDir.set(41, (endEncryption >> 16) & 255);
    xbDir.set(42, (endEncryption >> 8) & 255);
    xbDir.set(43, endEncryption & 255);
    xbDir.set(44, xbDir.get(14) || 0);
    xbDir.set(45, Math.floor(endEncryption / 256 / 256 / 256 / 256) & 255);
    xbDir.set(46, Math.floor(endEncryption / 256 / 256 / 256 / 256 / 256) & 255);

    xbDir.set(47, (this.aid >> 24) & 255);
    xbDir.set(48, (this.aid >> 16) & 255);
    xbDir.set(49, (this.aid >> 8) & 255);
    xbDir.set(50, this.aid & 255);

    const sortedValues: number[] = [];
    for (const idx of SORT_INDEX) {
      sortedValues.push(xbDir.get(idx) || 0);
    }

    let xbXor = 0;
    for (let i = 0; i < SORT_INDEX_2.length - 1; i++) {
      if (i === 0) {
        xbXor = xbDir.get(SORT_INDEX_2[i]) || 0;
      }
      xbXor ^= xbDir.get(SORT_INDEX_2[i + 1]) || 0;
    }

    const allValues = [...sortedValues, xbXor];
    const allBytes = new Uint8Array(allValues);
    const encrypted = rc4Encrypt(XB_KEY, allBytes);
    const encryptedStr = Array.from(encrypted)
      .map((b) => String.fromCharCode(b))
      .join("");
    const xbogus = this.xbEncode(encryptedStr);
    const signedParams = `${params}&X-Bogus=${xbogus}`;

    return {
      params: signedParams,
      xbogus,
      userAgent: this.userAgent,
    };
  }
}
