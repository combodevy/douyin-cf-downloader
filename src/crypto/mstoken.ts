/**
 * msToken 生成器
 * 优先从 F2 项目配置获取真实 msToken，失败时回退到随机伪造
 */
const F2_CONF_URL =
  "https://raw.githubusercontent.com/Johnserf-Seed/f2/main/f2/conf/conf.yaml";
function genFalseMsToken(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 182; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token + "==";
}
function isValidMsToken(token: string): boolean {
  return token.length === 164 || token.length === 184;
}
function extractMsTokenFromHeaders(headers: Headers): string | null {
  // Cloudflare Workers 中 Set-Cookie 可能被合并
  const setCookie = headers.get("set-cookie") || headers.get("Set-Cookie");
  if (!setCookie) return null;
  const match = setCookie.match(/msToken=([^;]+)/);
  return match ? match[1].trim() : null;
}
// 简单 YAML 解析（只需要 msToken 配置段）
function parseMsTokenConf(yaml: string): Record<string, string> | null {
  try {
    // 找到 msToken 段
    const lines = yaml.split("\n");
    let inMsToken = false;
    let indent = 0;
    const result: Record<string, string> = {};
    for (const line of lines) {
      if (line.includes("msToken:")) {
        inMsToken = true;
        indent = line.search(/\S/);
        continue;
      }
      if (inMsToken) {
        const currentIndent = line.search(/\S/);
        if (currentIndent <= indent && line.trim()) {
          break;
        }
        const match = line.match(/(\w+)\s*:\s*["']?([^"'\s]+)["']?/);
        if (match) {
          result[match[1]] = match[2];
        }
      }
    }
    const required = ["url", "magic", "version", "dataType", "ulr", "strData"];
    for (const key of required) {
      if (!result[key]) return null;
    }
    return result;
  } catch {
    return null;
  }
}
export async function ensureMsToken(
  existing: string = "",
  userAgent: string
): Promise<string> {
  if (existing && existing.trim()) return existing.trim();
  try {
    // 尝试获取 F2 配置
    const confResp = await fetch(F2_CONF_URL, {
      headers: { "User-Agent": userAgent },
      cf: { cacheTtl: 3600 },
    });
    if (!confResp.ok) throw new Error("conf fetch failed");
    const confText = await confResp.text();
    const conf = parseMsTokenConf(confText);
    if (!conf) throw new Error("conf parse failed");
    const payload = {
      magic: conf.magic,
      version: conf.version,
      dataType: conf.dataType,
      strData: conf.strData,
      ulr: conf.ulr,
      tspFromClient: Date.now(),
    };
    const resp = await fetch(conf.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": userAgent,
      },
      body: JSON.stringify(payload),
    });
    const token = extractMsTokenFromHeaders(resp.headers);
    if (token && isValidMsToken(token)) {
      return token;
    }
  } catch {
    // 静默失败，回退到伪造 token
  }
  return genFalseMsToken();
}
