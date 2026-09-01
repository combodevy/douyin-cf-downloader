/**
 * Cloudflare Workers 入口
 *
 * 路由：
 *   GET  /              → 前端页面（由 wrangler.toml [assets] 提供）
 *   GET  /api/parse     → 解析单个抖音链接
 *   GET  /api/user      → 用户作品列表
 *   GET  /api/search    → 关键词搜索
 *   GET  /api/hot       → 热搜榜
 *   GET  /proxy         → 代理下载（绕过 CORS）
 */
import { DouyinApiClient } from "./api/client";
import { extractMedia, type QualityLevel } from "./api/extractor";
import { parseUrl, resolveShortUrl } from "./parser";
import type { VideoDetail } from "./types";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

function addProxyUrls(
  result: ReturnType<typeof extractMedia>
): Record<string, unknown> {
  const assets = result.assets.map((a) => ({
    ...a,
    proxy_url: `/proxy?url=${encodeURIComponent(a.url)}&filename=${encodeURIComponent(a.filename)}`,
  }));
  return { ...result, assets };
}

async function handleParse(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");
  const quality = (url.searchParams.get("quality") || "highest") as QualityLevel;

  if (!targetUrl) {
    return jsonResponse({ success: false, error: "缺少 url 参数" }, 400);
  }

  const client = new DouyinApiClient();

  // 1. 解析 URL 类型
  let parsed = parseUrl(targetUrl);
  if (!parsed) {
    return jsonResponse({ success: false, error: "无法识别的抖音链接" }, 400);
  }

  // 2. 短链解析
  if (parsed.type === "short") {
    const resolved = await resolveShortUrl(targetUrl, client["userAgent"] as string);
    if (!resolved) {
      return jsonResponse({ success: false, error: "短链解析失败" }, 502);
    }
    parsed = parseUrl(resolved);
    if (!parsed) {
      return jsonResponse({ success: false, error: "短链重定向后无法识别" }, 400);
    }
  }

  // 3. 仅支持 video / gallery
  if (parsed.type !== "video" && parsed.type !== "gallery") {
    return jsonResponse(
      { success: false, error: `暂不支持的链接类型: ${parsed.type}` },
      400
    );
  }

  if (!parsed.aweme_id) {
    return jsonResponse({ success: false, error: "无法提取作品 ID" }, 400);
  }

  // 4. 获取作品详情
  const detail = await client.getVideoDetail(parsed.aweme_id);
  if (!detail) {
    return jsonResponse(
      { success: false, error: "获取作品详情失败（可能被风控，请稍后重试）" },
      502
    );
  }

  // 5. 提取媒体
  const result = extractMedia(detail, quality);
  const withProxy = addProxyUrls(result);
  return jsonResponse(withProxy);
}

async function handleUser(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const secUid = url.searchParams.get("sec_uid");
  const cursor = Number(url.searchParams.get("cursor") || 0);
  const count = Number(url.searchParams.get("count") || 20);

  if (!secUid) {
    return jsonResponse({ success: false, error: "缺少 sec_uid 参数" }, 400);
  }

  const client = new DouyinApiClient();
  const resp = await client.getUserVideos(secUid, cursor, count);

  if (resp.status_code !== 0) {
    return jsonResponse(
      { success: false, error: "获取用户作品失败", status_code: resp.status_code },
      502
    );
  }

  const items = resp.items.map((item: VideoDetail) => ({
    aweme_id: item.aweme_id,
    desc: item.desc,
    create_time: item.create_time,
    author: item.author?.nickname,
    media_type: item.images?.length ? "gallery" : "video",
    cover: item.video?.cover?.url_list?.[0],
  }));

  return jsonResponse({
    success: true,
    items,
    has_more: resp.has_more,
    max_cursor: resp.max_cursor,
  });
}

async function handleSearch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const offset = Number(url.searchParams.get("offset") || 0);
  const count = Number(url.searchParams.get("count") || 10);
  const sort = Number(url.searchParams.get("sort") || 0);

  if (!q) {
    return jsonResponse({ success: false, error: "缺少 q 参数" }, 400);
  }

  const client = new DouyinApiClient();
  const resp = await client.search(q, offset, count, sort);

  const items = resp.items.map((item: VideoDetail) => ({
    aweme_id: item.aweme_id,
    desc: item.desc,
    author: item.author?.nickname,
    media_type: item.images?.length ? "gallery" : "video",
    cover: item.video?.cover?.url_list?.[0],
  }));

  return jsonResponse({
    success: true,
    items,
    has_more: resp.has_more,
    max_cursor: resp.max_cursor,
  });
}

async function handleHot(): Promise<Response> {
  const client = new DouyinApiClient();
  const items = await client.getHotList();
  return jsonResponse({ success: true, items });
}

async function handleProxy(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");
  const filename = url.searchParams.get("filename") || "download";

  if (!targetUrl) {
    return new Response("缺少 url 参数", { status: 400 });
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://www.douyin.com/",
      },
    });

    const contentType =
      upstream.headers.get("Content-Type") || "application/octet-stream";
    const contentLength = upstream.headers.get("Content-Length");

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    if (contentLength) headers.set("Content-Length", contentLength);
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    return new Response(`代理下载失败: ${(err as Error).message}`, {
      status: 502,
    });
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS 预检
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET") {
      return jsonResponse({ success: false, error: "仅支持 GET 请求" }, 405);
    }

    try {
      if (path === "/api/parse") return await handleParse(request);
      if (path === "/api/user") return await handleUser(request);
      if (path === "/api/search") return await handleSearch(request);
      if (path === "/api/hot") return await handleHot();
      if (path === "/proxy") return await handleProxy(request);

      // 根路径由 wrangler [assets] 提供静态文件
      return new Response("Not Found", { status: 404 });
    } catch (err) {
      return jsonResponse(
        { success: false, error: `服务器错误: ${(err as Error).message}` },
        500
      );
    }
  },
};
