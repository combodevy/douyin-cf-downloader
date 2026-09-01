/**
 * msToken 动态获取（转译自 Python utils/mstoken.py）
 *
 * 优先从 F2 项目配置拉取真实 msToken，失败回退随机伪造
 */
const F2_CONFIG_URL =
  "https://raw.githubusercontent.com/Johnserf-Seed/f2/main/f2/apps/douyin/conf/msToken.json";

let cachedToken: string | null = null;
let cacheTime = 0;
const CACHE_TTL = 3600000; // 1 小时

export async function getMsToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now - cacheTime < CACHE_TTL) {
    return cachedToken;
  }
  try {
    const resp = await fetch(F2_CONFIG_URL, {
      headers: { Accept: "application/json" },
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data && typeof data.msToken === "string" && data.msToken.length > 0) {
        cachedToken = data.msToken;
        cacheTime = now;
        return cachedToken;
      }
    }
  } catch {
    // 网络失败，回退伪造
  }
  return generateFakeMsToken();
}

function generateFakeMsToken(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 128; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}
