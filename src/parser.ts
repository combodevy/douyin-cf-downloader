/**
 * URL 解析器（转译自 Python core/url_parser.py + utils/validators.py）
 */
import type { ParsedUrl, UrlType } from "./types";
const SHORT_URL_HOSTS = ["v.douyin.com", "v.iesdouyin.com", "iesdouyin.com"];
function hostMatches(host: string, base: string): boolean {
  return host === base || host.endsWith("." + base);
}
function isDouyinWebHost(host: string): boolean {
  return hostMatches(host, "douyin.com") || hostMatches(host, "iesdouyin.com");
}
function isShortUrl(url: string): boolean {
  if (!url) return false;
  let lowered = url.trim().toLowerCase();
  for (const scheme of ["https://", "http://"]) {
    if (lowered.startsWith(scheme)) {
      lowered = lowered.slice(scheme.length);
      break;
    }
  }
  return SHORT_URL_HOSTS.some((h) => lowered.startsWith(h + "/") || lowered === h);
}
export function parseUrlType(url: string): UrlType | null {
  if (isShortUrl(url)) return "short";
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  // 直播回放
  if (isDouyinWebHost(host) && /^\/vsdetail\/\d+\/?$/.test(path)) {
    return "live_replay";
  }
  if (host === "webcast.amemv.com" && /^\/douyin\/webcast\/reflow\/episode\/\d+\/?$/.test(path)) {
    return "live_replay";
  }
  // 直播 reflow
  if (host === "webcast.amemv.com" && /^\/douyin\/webcast\/reflow\/\d+\/?$/.test(path)) {
    return "live";
  }
  if (!isDouyinWebHost(host)) return null;
  // modal_id 优先
  const modalId = parsed.searchParams.get("modal_id");
  if (modalId && modalId.trim()) return "video";
  if (host === "live.douyin.com") {
    return /^\/\d+\/?$/.test(path) ? "live" : null;
  }
  if (path.includes("/lvdetail/")) return "lvdetail";
  if (path.includes("/video/")) return "video";
  if (path.includes("/user/")) return "user";
  if (path.includes("/note/") || path.includes("/gallery/") || path.includes("/slides/"))
    return "gallery";
  if (path.includes("/collection/") || path.includes("/mix/")) return "collection";
  if (path.includes("/music/")) return "music";
  if (/^\/(?:follow\/|share\/)?live\/\d+\/?$/.test(path)) return "live";
  return null;
}
export function parseUrl(url: string): ParsedUrl | null {
  const type = parseUrlType(url);
  if (!type) return null;
  const result: ParsedUrl = { originalUrl: url, type };
  switch (type) {
    case "video": {
      const m = url.match(/\/video\/(\d+)/);
      if (m) result.aweme_id = m[1];
      else {
        const modal = url.match(/modal_id=(\d+)/);
        if (modal) result.aweme_id = modal[1];
      }
      break;
    }
    case "gallery": {
      const m = url.match(/\/(?:note|gallery|slides)\/(\d+)/);
      if (m) {
        result.note_id = m[1];
        result.aweme_id = m[1];
      }
      break;
    }
    case "user": {
      const m = url.match(/\/user\/([A-Za-z0-9_-]+)/);
      if (m) result.sec_uid = m[1];
      break;
    }
    case "collection": {
      const m = url.match(/\/(?:collection|mix)\/(\d+)/);
      if (m) result.mix_id = m[1];
      break;
    }
    case "music": {
      const m = url.match(/\/music\/(\d+)/);
      if (m) result.music_id = m[1];
      break;
    }
    case "live": {
      const parsed = new URL(url);
      if (parsed.hostname === "webcast.amemv.com") {
        const m = parsed.pathname.match(/\/douyin\/webcast\/reflow\/(\d+)/);
        if (m) {
          result.room_id = m[1];
          result.room_id_kind = "room_id";
          result.sec_user_id = parsed.searchParams.get("sec_user_id") || undefined;
        }
      } else {
        const m = url.match(/(?:live\.douyin\.com|\/(?:follow|share)\/live)\/(\d+)/);
        if (m) result.room_id = m[1];
      }
      break;
    }
    case "live_replay": {
      const parsed = new URL(url);
      const m = parsed.pathname.match(/(?:vsdetail|reflow\/episode)\/(\d+)/);
      if (m) result.episode_id = m[1];
      const replayId = parsed.searchParams.get("replay_id");
      if (replayId && /^\d+$/.test(replayId)) result.replay_id = replayId;
      break;
    }
  }
  return result;
}
export async function resolveShortUrl(
  shortUrl: string,
  userAgent: string
): Promise<string | null> {
  try {
    const resp = await fetch(shortUrl, {
      redirect: "follow",
      headers: { "User-Agent": userAgent },
    });
    if (resp.status >= 400) return null;
    return resp.url;
  } catch {
    return null;
  }
}
