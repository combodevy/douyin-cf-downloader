/**
 * Cloudflare Workers 入口
 *
 * 路由：
 *   GET  /                  → 前端页面（静态资源）
 *   GET  /api/parse?url=    → 解析抖音链接，返回媒体直链
 *   GET  /api/user?sec_uid= → 获取用户作品列表
 *   GET  /api/hot           → 热搜榜
 *   GET  /api/search?q=     → 关键词搜索
 *   GET  /proxy?url=        → 代理下载（绕过 CORS，流式转发）
 *   GET  /health            → 健康检查
 */
import { DouyinApiClient } from "./api/client";
import { extractAssets } from "./api/extractor";
import { parseUrl, resolveShortUrl, parseUrlType } from "./parser";
import type { VideoDetail } from "./types";
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}
function errorResponse(message: string, status: number = 400): Response {
  return jsonResponse({ success: false, error: message }, status);
}
export default {
  async fetch(
    request: Request,
    env: Record<string, string>,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    // CORS 预检
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const path = url.pathname;
    try {
      // ─── API 路由 ────────────────────────────────────────────
      if (path === "/api/parse" || path === "/api/parse/") {
        return await handleParse(request, url);
      }
      if (path === "/api/user" || path === "/api/user/") {
        return await handleUser(request, url);
      }
      if (path === "/api/hot" || path === "/api/hot/") {
        return await handleHot(request);
      }
      if (path === "/api/search" || path === "/api/search/") {
        return await handleSearch(request, url);
      }
      if (path === "/proxy" || path === "/proxy/") {
        return await handleProxy(request, url);
      }
      if (path === "/health" || path === "/health/") {
        return jsonResponse({ status: "ok", timestamp: Date.now() });
      }
      // ─── 静态资源（由 wrangler [assets] 处理，这里兜底） ──────
      return new Response("Not Found", { status: 404 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(`服务器内部错误: ${message}`, 500);
    }
  },
};
// ─── 解析单个链接 ──────────────────────────────────────────────
async function handleParse(request: Request, url: URL): Promise<Response> {
  const targetUrl = url.searchParams.get("url");
  if (!targetUrl) {
    return errorResponse("缺少 url 参数");
  }
  const quality = (url.searchParams.get("quality") as
    | "highest"
    | "lowest"
    | "1080p"
    | "720p"
    | "540p"
    | "480p") || "highest";
  const client = new DouyinApiClient({ userAgent: DEFAULT_UA });
  // 短链解析
  let resolvedUrl = targetUrl;
  if (parseUrlType(targetUrl) === "short") {
    const resolved = await resolveShortUrl(targetUrl, DEFAULT_UA);
    if (!resolved) {
      return errorResponse("短链解析失败", 502);
    }
    resolvedUrl = resolved;
  }
  const parsed = parseUrl(resolvedUrl);
  if (!parsed) {
    return errorResponse("无法识别的抖音链接格式");
  }
  if (parsed.type === "lvdetail") {
    return errorResponse("放映厅版权影视内容受 DRM 加密保护，无法下载");
  }
  if (parsed.type === "live") {
    return errorResponse("直播链接请使用直播录制功能（暂未在 Web 版开放）");
  }
  if (parsed.type === "live_replay") {
    return errorResponse("直播回放下载暂未在 Web 版开放");
  }
  if (parsed.type === "user") {
    // 用户主页：返回用户信息和作品列表入口
    return jsonResponse({
      success: true,
      type: "user",
      sec_uid: parsed.sec_uid,
      message: "用户主页链接，请使用 /api/user?sec_uid=xxx 获取作品列表",
    });
  }
  if (parsed.type === "collection") {
    return errorResponse("合集下载请使用 /api/mix?mix_id=xxx（暂未开放）");
  }
  if (parsed.type === "music") {
    return errorResponse("音乐下载暂未在 Web 版开放");
  }
  // 单视频/图文
  const awemeId = parsed.aweme_id;
  if (!awemeId) {
    return errorResponse("无法从链接中提取作品 ID");
  }
  // 双 aid 重试：6383 兼容图文，1128 对视频更友好
  let detail: VideoDetail | null = null;
  try {
    detail = await client.getVideoDetail(awemeId, 6383);
  } catch {
    // 6383 失败，尝试 1128
  }
  if (!detail) {
    try {
      detail = await client.getVideoDetail(awemeId, 1128);
    } catch {
      // ignore
    }
  }
  if (!detail) {
    return errorResponse("获取作品详情失败（可能被风控或作品已删除）", 502);
  }
  const extracted = extractAssets(detail, { videoQuality: quality });
  if (extracted.assets.length === 0) {
    return errorResponse("未找到可下载的媒体资源");
  }
  return jsonResponse({
    success: true,
    type: "single",
    aweme_id: detail.aweme_id,
    title: extracted.title,
    author: extracted.author,
    author_sec_uid: extracted.authorSecUid,
    create_time: extracted.createTime,
    create_date: extracted.createTime
      ? new Date(extracted.createTime * 1000).toISOString().slice(0, 10)
      : null,
    media_type: extracted.mediaType,
    is_paid: extracted.isPaid,
    cover_url: extracted.coverUrl,
    quality,
    assets: extracted.assets.map((a) => ({
      type: a.type,
      url: a.url,
      filename: a.filename,
      width: a.width,
      height: a.height,
      quality: a.quality,
      watermark: a.watermark,
      // 提供代理下载链接（绕过 CORS）
      proxy_url: `/proxy?url=${encodeURIComponent(a.url)}&filename=${encodeURIComponent(a.filename)}`,
    })),
    raw_detail: detail,
  });
}
// ─── 用户作品列表 ──────────────────────────────────────────────
async function handleUser(request: Request, url: URL): Promise<Response> {
  const secUid = url.searchParams.get("sec_uid");
  if (!secUid) {
    return errorResponse("缺少 sec_uid 参数");
  }
  const maxCursor = Number(url.searchParams.get("cursor") || 0);
  const count = Math.min(Number(url.searchParams.get("count") || 20), 35);
  const client = new DouyinApiClient({ userAgent: DEFAULT_UA });
  try {
    const page = await client.getUserPosts(secUid, maxCursor, count);
    return jsonResponse({
      success: true,
      has_more: page.has_more,
      max_cursor: page.max_cursor,
      count: page.items.length,
      items: page.items.map((item) => ({
        aweme_id: item.aweme_id,
        desc: item.desc,
        create_time: item.create_time,
        author: item.author?.nickname,
        cover: item.video?.cover?.url_list?.[0],
        media_type: item.images?.length ? "gallery" : "video",
        parse_url: `/api/parse?url=https://www.douyin.com/video/${item.aweme_id}`,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(`获取用户作品失败: ${message}`, 502);
  }
}
// ─── 热搜榜 ────────────────────────────────────────────────────
async function handleHot(request: Request): Promise<Response> {
  const client = new DouyinApiClient({ userAgent: DEFAULT_UA });
  try {
    const data = await client.getHotSearchBoard();
    const wordList = (data["word_list"] as Array<Record<string, unknown>>) || [];
    return jsonResponse({
      success: true,
      count: wordList.length,
      items: wordList.map((w, i) => ({
        rank: i + 1,
        word: w["word"],
        hot_value: w["hot_value"],
        label: w["label"],
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(`获取热搜失败: ${message}`, 502);
  }
}
// ─── 关键词搜索 ────────────────────────────────────────────────
async function handleSearch(request: Request, url: URL): Promise<Response> {
  const keyword = url.searchParams.get("q");
  if (!keyword) {
    return errorResponse("缺少 q 参数");
  }
  const offset = Number(url.searchParams.get("offset") || 0);
  const count = Math.min(Number(url.searchParams.get("count") || 10), 20);
  const sortType = Number(url.searchParams.get("sort") || 0);
  const client = new DouyinApiClient({ userAgent: DEFAULT_UA });
  try {
    const page = await client.searchAweme(keyword, offset, count, sortType);
    return jsonResponse({
      success: true,
      keyword,
      has_more: page.has_more,
      max_cursor: page.max_cursor,
      count: page.items.length,
      items: page.items.map((item) => ({
        aweme_id: item.aweme_id,
        desc: item.desc,
        author: item.author?.nickname,
        cover: item.video?.cover?.url_list?.[0],
        parse_url: `/api/parse?url=https://www.douyin.com/video/${item.aweme_id}`,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(`搜索失败: ${message}`, 502);
  }
}
// ─── 代理下载（流式转发，绕过 CORS） ───────────────────────────
async function handleProxy(request: Request, url: URL): Promise<Response> {
  const targetUrl = url.searchParams.get("url");
  if (!targetUrl) {
    return errorResponse("缺少 url 参数");
  }
  const filename = url.searchParams.get("filename") || "download";
  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        "User-Agent": DEFAULT_UA,
        Referer: "https://www.douyin.com/",
        Accept: "*/*",
      },
      cf: { cacheTtl: 300 },
    });
    if (!upstream.ok && upstream.status !== 206) {
      return errorResponse(`上游返回 ${upstream.status}`, 502);
    }
    // 构建响应头
    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
    headers.set(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(filename)}"`
    );
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "public, max-age=300");
    // 流式转发
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(`代理下载失败: ${message}`, 502);
  }
}
