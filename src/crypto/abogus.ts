/**
 * a_bogus 签名算法（转译自 Python utils/abogus.py）
 * 基于 Johnserf-Seed/F2 项目的逆向实现
 *
 * 算法流程：
 * 1. 对 params/body/UA 分别做 SM3 加盐哈希，取特定字节
 * 2. 构建 72 字节数据帧（时间戳、options、哈希值、aid、指纹长度等）
 * 3. 按 sort_index 重排 + 链式异或校验
 * 4. 256 元素大数组流加密（transform_bytes）
 * 5. 自定义 Base64 编码输出
 */
import { sm3ToArray } from "./sm3";
import { rc4Encrypt } from "./rc4";
// ─── 自定义 Base64 字符表 ───────────────────────────────────────
const CHARACTER =
  "Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe";
const CHARACTER2 =
  "ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe";
const CHARACTER_LIST = [CHARACTER, CHARACTER2];
// ─── transform_bytes 使用的 256 元素大数组 ──────────────────────
const BIG_ARRAY: number[] = [
  121, 243, 55, 234, 103, 36, 47, 228, 30, 231, 106, 6, 115, 95, 78, 101,
  250, 207, 198, 50, 139, 227, 220, 105, 97, 143, 34, 28, 194, 215, 18, 100,
  159, 160, 43, 8, 169, 217, 180, 120, 247, 45, 90, 11, 27, 197, 46, 3, 84,
  72, 5, 68, 62, 56, 221, 75, 144, 79, 73, 161, 178, 81, 64, 187, 134, 117,
  186, 118, 16, 241, 130, 71, 89, 147, 122, 129, 65, 40, 88, 150, 110, 219,
  199, 255, 181, 254, 48, 4, 195, 248, 208, 32, 116, 167, 69, 201, 17, 124,
  125, 104, 96, 83, 80, 127, 236, 108, 154, 126, 204, 15, 20, 135, 112, 158,
  13, 1, 188, 164, 210, 237, 222, 98, 212, 77, 253, 42, 170, 202, 26, 22, 29,
  182, 251, 10, 173, 152, 58, 138, 54, 141, 185, 33, 157, 31, 252, 132, 233,
  235, 102, 196, 191, 223, 240, 148, 39, 123, 92, 82, 128, 109, 57, 24, 38,
  113, 209, 245, 2, 119, 153, 229, 189, 214, 230, 174, 232, 63, 52, 205, 86,
  140, 66, 175, 111, 171, 246, 133, 238, 193, 99, 60, 74, 91, 225, 51, 76,
  37, 145, 211, 166, 151, 213, 206, 0, 200, 244, 176, 218, 44, 184, 172, 49,
  216, 93, 168, 53, 21, 183, 41, 67, 85, 224, 155, 226, 242, 87, 177, 146,
  70, 190, 12, 162, 19, 137, 114, 25, 165, 163, 192, 23, 59, 9, 94, 179, 107,
  35, 7, 142, 131, 239, 203, 149, 136, 61, 249, 14, 156,
];
// ─── 排序索引 ──────────────────────────────────────────────────
const SORT_INDEX = [
  18, 20, 52, 26, 30, 34, 58, 38, 40, 53, 42, 21, 27, 54, 55, 31, 35, 57, 39,
  41, 43, 22, 28, 32, 60, 36, 23, 29, 33, 37, 44, 45, 59, 46, 47, 48, 49, 50,
  24, 25, 65, 66, 70, 71,
];
const SORT_INDEX_2 = [
  18, 20, 26, 30, 34, 38, 40, 42, 21, 27, 31, 35, 39, 41, 43, 22, 28, 32, 36,
  23, 29, 33, 37, 44, 45, 46, 47, 48, 49, 50, 24, 25, 52, 53, 54, 55, 57, 58,
  59, 60, 65, 66, 70, 71,
];
const SALT = "cus";
const UA_KEY = new Uint8Array([0x00, 0x01, 0x0e]);
// ─── 工具函数 ──────────────────────────────────────────────────
function jsShiftRight(val: number, n: number): number {
  return (val % 0x100000000) >>> n;
}
function generateRandomBytes(length: number = 3): string {
  let result = "";
  for (let _ = 0; _ < length; _++) {
    const rd = Math.floor(Math.random() * 10000);
    result += String.fromCharCode(
      ((rd & 255) & 170) | 1,
      ((rd & 255) & 85) | 2,
      (jsShiftRight(rd, 8) & 170) | 5,
      (jsShiftRight(rd, 8) & 85) | 40
    );
  }
  return result;
}
/** 对应 Python params_to_array：SM3 加盐哈希 → 字节数组 */
function paramsToArray(param: string, addSalt: boolean = true): number[] {
  const processed = addSalt ? param + SALT : param;
  return sm3ToArray(processed);
}
/**
 * 对应 Python 第二次 params_to_array（输入为 list 时 process_param 不加盐）。
 * 直接对字节数组做 SM3，不添加盐值。
 */
function sm3Bytes(bytes: number[]): number[] {
  return sm3ToArray(new Uint8Array(bytes));
}
/** 对应 Python transform_bytes：256 元素大数组流加密 */
function transformBytes(bytesList: number[]): string {
  const arr = [...BIG_ARRAY]; // 复制，因为会修改
  let result = "";
  let indexB = arr[1];
  let initialValue = 0;
  let valueE = 0;
  for (let index = 0; index < bytesList.length; index++) {
    let sumInitial: number;
    if (index === 0) {
      initialValue = arr[indexB];
      sumInitial = indexB + initialValue;
      arr[1] = initialValue;
      arr[indexB] = indexB;
    } else {
      sumInitial = initialValue + valueE;
    }
    const charValue = bytesList[index];
    sumInitial = sumInitial % arr.length;
    const valueF = arr[sumInitial];
    const encryptedChar = charValue ^ valueF;
    result += String.fromCharCode(encryptedChar);
    valueE = arr[(index + 2) % arr.length];
    sumInitial = (indexB + valueE) % arr.length;
    initialValue = arr[sumInitial];
    arr[sumInitial] = arr[(index + 2) % arr.length];
    arr[(index + 2) % arr.length] = initialValue;
    indexB = sumInitial;
  }
  return result;
}
/** 对应 Python abogus_encode：自定义 Base64 编码（3字节→4字符） */
function abogusEncode(abogusBytesStr: string, alphabetIndex: number): string {
  const alphabet = CHARACTER_LIST[alphabetIndex];
  const abogus: string[] = [];
  for (let i = 0; i < abogusBytesStr.length; i += 3) {
    let n: number;
    if (i + 2 < abogusBytesStr.length) {
      n =
        (abogusBytesStr.charCodeAt(i) << 16) |
        (abogusBytesStr.charCodeAt(i + 1) << 8) |
        abogusBytesStr.charCodeAt(i + 2);
    } else if (i + 1 < abogusBytesStr.length) {
      n =
        (abogusBytesStr.charCodeAt(i) << 16) |
        (abogusBytesStr.charCodeAt(i + 1) << 8);
    } else {
      n = abogusBytesStr.charCodeAt(i) << 16;
    }
    const shifts = [18, 12, 6, 0];
    const masks = [0xfc0000, 0x03f000, 0x0fc0, 0x3f];
    for (let j = 0; j < 4; j++) {
      if (shifts[j] === 6 && i + 1 >= abogusBytesStr.length) break;
      if (shifts[j] === 0 && i + 2 >= abogusBytesStr.length) break;
      abogus.push(alphabet[(n & masks[j]) >> shifts[j]]);
    }
  }
  const padCount = (4 - (abogus.length % 4)) % 4;
  abogus.push("=".repeat(padCount));
  return abogus.join("");
}
/** 对应 Python base64_encode（用于 UA 的 RC4 结果） */
function base64Encode(inputString: string, alphabetIndex: number = 0): string {
  const alphabet = CHARACTER_LIST[alphabetIndex];
  let binary = "";
  for (let i = 0; i < inputString.length; i++) {
    binary += inputString.charCodeAt(i).toString(2).padStart(8, "0");
  }
  const paddingLength = (6 - (binary.length % 6)) % 6;
  binary += "0".repeat(paddingLength);
  let output = "";
  for (let i = 0; i < binary.length; i += 6) {
    const idx = parseInt(binary.substring(i, i + 6), 2);
    output += alphabet[idx];
  }
  output += "=".repeat(paddingLength / 2);
  return output;
}
// ─── 浏览器指纹生成器 ──────────────────────────────────────────
export function generateBrowserFingerprint(platform: string = "Win32"): string {
  const innerWidth = Math.floor(Math.random() * (1920 - 1024 + 1)) + 1024;
  const innerHeight = Math.floor(Math.random() * (1080 - 768 + 1)) + 768;
  const outerWidth = innerWidth + Math.floor(Math.random() * (32 - 24 + 1)) + 24;
  const outerHeight = innerHeight + Math.floor(Math.random() * (90 - 75 + 1)) + 75;
  const screenX = 0;
  const screenY = Math.random() > 0.5 ? 0 : 30;
  const sizeWidth = Math.floor(Math.random() * (1920 - 1024 + 1)) + 1024;
  const sizeHeight = Math.floor(Math.random() * (1080 - 768 + 1)) + 768;
  const availWidth = Math.floor(Math.random() * (1920 - 1280 + 1)) + 1280;
  const availHeight = Math.floor(Math.random() * (1080 - 800 + 1)) + 800;
  return (
    `${innerWidth}|${innerHeight}|${outerWidth}|${outerHeight}|` +
    `${screenX}|${screenY}|0|0|${sizeWidth}|${sizeHeight}|` +
    `${availWidth}|${availHeight}|${innerWidth}|${innerHeight}|24|24|${platform}`
  );
}
// ─── a_bogus 主类 ──────────────────────────────────────────────
export interface ABogusResult {
  params: string;
  abogus: string;
  userAgent: string;
  body: string;
}
export class ABogus {
  private aid = 6383;
  private pageId = 0;
  private options: number[];
  private userAgent: string;
  private browserFp: string;
  constructor(
    userAgent: string = "",
    fp: string = "",
    options: number[] = [0, 1, 14]
  ) {
    this.options = options;
    this.userAgent =
      userAgent ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
    this.browserFp = fp || generateBrowserFingerprint("Win32");
  }
  generate(params: string, body: string = ""): ABogusResult {
    // ab_dir 用 Map 存储固定索引的数据
    const abDir = new Map<number, number>();
    abDir.set(8, 3);
    abDir.set(18, 44);
    abDir.set(66, 0);
    abDir.set(69, 0);
    abDir.set(70, 0);
    abDir.set(71, 0);
    const startEncryption = Date.now();
    // 三路哈希（双重 SM3：第一次加盐，第二次输入为字节数组不加盐）
    const array1 = sm3Bytes(paramsToArray(params));
    const array2 = sm3Bytes(paramsToArray(body));
    // UA: RC4 加密 → Base64 → SM3（不加盐）
    const uaRc4 = rc4Encrypt(UA_KEY, this.userAgent);
    const uaB64 = base64Encode(
      Array.from(uaRc4).map((b) => String.fromCharCode(b)).join(""),
      1
    );
    const array3 = paramsToArray(uaB64, false);
    const endEncryption = Date.now();
    // 插入时间戳
    abDir.set(20, (startEncryption >> 24) & 255);
    abDir.set(21, (startEncryption >> 16) & 255);
    abDir.set(22, (startEncryption >> 8) & 255);
    abDir.set(23, startEncryption & 255);
    abDir.set(24, Math.floor(startEncryption / 256 / 256 / 256 / 256));
    abDir.set(25, Math.floor(startEncryption / 256 / 256 / 256 / 256 / 256));
    // options
    abDir.set(26, (this.options[0] >> 24) & 255);
    abDir.set(27, (this.options[0] >> 16) & 255);
    abDir.set(28, (this.options[0] >> 8) & 255);
    abDir.set(29, this.options[0] & 255);
    abDir.set(30, Math.floor(this.options[1] / 256) & 255);
    abDir.set(31, (this.options[1] % 256) & 255);
    abDir.set(32, (this.options[1] >> 24) & 255);
    abDir.set(33, (this.options[1] >> 16) & 255);
    abDir.set(34, (this.options[2] >> 24) & 255);
    abDir.set(35, (this.options[2] >> 16) & 255);
    abDir.set(36, (this.options[2] >> 8) & 255);
    abDir.set(37, this.options[2] & 255);
    // 哈希值
    abDir.set(38, array1[21]);
    abDir.set(39, array1[22]);
    abDir.set(40, array2[21]);
    abDir.set(41, array2[22]);
    abDir.set(42, array3[23]);
    abDir.set(43, array3[24]);
    // 结束时间
    abDir.set(44, (endEncryption >> 24) & 255);
    abDir.set(45, (endEncryption >> 16) & 255);
    abDir.set(46, (endEncryption >> 8) & 255);
    abDir.set(47, endEncryption & 255);
    abDir.set(48, abDir.get(8) || 0);
    abDir.set(49, Math.floor(endEncryption / 256 / 256 / 256 / 256));
    abDir.set(50, Math.floor(endEncryption / 256 / 256 / 256 / 256 / 256));
    // pageId + aid
    abDir.set(51, (this.pageId >> 24) & 255);
    abDir.set(52, (this.pageId >> 16) & 255);
    abDir.set(53, (this.pageId >> 8) & 255);
    abDir.set(54, this.pageId & 255);
    abDir.set(55, this.pageId);
    abDir.set(56, this.aid);
    abDir.set(57, this.aid & 255);
    abDir.set(58, (this.aid >> 8) & 255);
    abDir.set(59, (this.aid >> 16) & 255);
    abDir.set(60, (this.aid >> 24) & 255);
    // 浏览器指纹长度
    abDir.set(64, this.browserFp.length);
    abDir.set(65, this.browserFp.length);
    // 按 sort_index 取值
    const sortedValues: number[] = [];
    for (const idx of SORT_INDEX) {
      sortedValues.push(abDir.get(idx) || 0);
    }
    // 浏览器指纹 ASCII 数组
    const fpArray: number[] = [];
    for (let i = 0; i < this.browserFp.length; i++) {
      fpArray.push(this.browserFp.charCodeAt(i));
    }
    // 链式异或
    let abXor = (this.browserFp.length & 255) >> 8;
    for (let i = 0; i < SORT_INDEX_2.length - 1; i++) {
      if (i === 0) {
        abXor = abDir.get(SORT_INDEX_2[i]) || 0;
      }
      abXor ^= abDir.get(SORT_INDEX_2[i + 1]) || 0;
    }
    const allValues = [...sortedValues, ...fpArray, abXor];
    // 伪随机前缀 + 流加密
    const abogusBytesStr =
      generateRandomBytes() + transformBytes(allValues);
    const abogus = abogusEncode(abogusBytesStr, 0);
    const signedParams = `${params}&a_bogus=${abogus}`;
    return {
      params: signedParams,
      abogus,
      userAgent: this.userAgent,
      body,
    };
  }
}
