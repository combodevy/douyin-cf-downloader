/**
 * 抖音 API 客户端（转译自 Python core/api_client.py）
 */
import { ABogus } from "../crypto/abogus";
import { XBogus } from "../crypto/xbogus";
import { ensureMsToken } from "../crypto/mstoken";
import type { PagedResponse, VideoDetail } from "../types";

const API_BASE = "https://www.douyin.com/aweme/v1/web";
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const DEFAULT_REFERER = "https://www.douyin.com/?recommend=1";
const RISK_CONTROL_STATUSES = new Set([403, 412, 429]);
const RETRY_DELAYS = [1, 2, 5];

export interface ApiClientOptions {
  cookies?: string;
  userAgent?: string;
  msToken?: string;
}

export class DouyinApiClient {
  private cookies: Record<string, string> = {};
  private userAgent: string;
  private msToken: string;
  private abogus: ABogus;
  private xbogus: XBogus;

  constructor(options: ApiClientOptions = {}) {
    this.userAgent = options.userAgent || DEFAULT_UA;
    this.msToken = options.msToken || "";
    this.abogus = new ABogus(this.userAgent);
    this.xbogus = new XBogus(this.userAgent);
    if (options.cookies) {
      this.parseCookies(options.cookies);
    }
  }

  private parseCookies(cookieStr: string): void {
    for (const part of cookieStr.split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k && v.length) {
        this.cookies[k.trim()] = v.join("=").trim();
      }
    }
  }

  private getCookieString(): string {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  async ensureTokens(): Promise<void> {
    if (!this.cookies["ttwid"]) this.cookies["ttwid"] = this.genTtwid();
    if (!this.cookies["odin_tt"]) this.cookies["odin_tt"] = this.genOdinTt();
    if (!this.cookies["passport_csrf_token"]) this.cookies["passport_csrf_token"] = this.genCsrfToken();
    if (!this.msToken) this.msToken = await ensureMsToken("", this.userAgent);
    this.cookies["msToken"] = this.msToken;
  }

  private genTtwid(): string {
    const ts = Math.floor(Date.now() / 1000);
    const rand = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    const payload = btoa(JSON.stringify({ id: Math.random().toString(36).slice(2, 10), createTime: ts }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `1%7C${payload}%7C${ts}%7C${rand}`;
  }

  private genOdinTt(): string {
    return Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  }

  private genCsrfToken(): string {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  }

  private buildBaseParams(aid: number = 6383): Record<string, string> {
    return {
      aid: String(aid),
      device_platform: "webapp",
      channel: "channel_pc_web",
      pc_client_type: "1",
      version_code: "290100",
      version_name: "29.1.0",
      cookie_enabled: "true",
      screen_width: "1536",
      screen_height: "864",
      browser_language: "zh-CN",
      browser_platform: "Win32",
      browser_name: "Chrome",
      browser_version: "139.0.0.0",
      browser_online: "true",
      engine_name: "Blink",
      engine_version: "139.0.0.0",
      os_name: "Windows",
      os_version: "10",
      cpu_core_num: "16",
      device_memory: "8",
      platform: "PC",
      downlink: "10",
      effective_type: "4g",
      round_trip_time: "200",
      webid: this.genWebId(),
      msToken: this.msToken,
      pc_libra_divert: "Windows",
      support_h265: "1",
      support_dash: "1",
      uifid: "",
    };
  }

  private genWebId(): string {
    return String(Math.floor(Math.random() * 9000000000000000000) + 1000000000000000000);
  }

  private buildQueryString(params: Record<string, string>): string {
    return Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
  }

  private buildHeaders(referer: string): Record<string, string> {
    return {
      "User-Agent": this.userAgent,
      Referer: referer || DEFAULT_REFERER,
      Accept: "*/*",
      "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
      Cookie: this.getCookieString(),
    };
  }

  private sleep(seconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }

  async signedGet(
    endpoint: string,
    params: Record<string, string>,
    aid: number = 6383,
    referer: string = ""
  ): Promise<Record<string, unknown>> {
    await this.ensureTokens();
    const ref = referer || DEFAULT_REFERER;
    const aidCandidates = aid === 6383 ? [6383, 1128] : [aid];
    let lastError: Error | null = null;

    for (const currentAid of aidCandidates) {
      const baseParams = this.buildBaseParams(currentAid);
      const allParams = { ...baseParams, ...params };
      const queryString = this.buildQueryString(allParams);

      for (let attempt = 0; attempt < 3; attempt++) {
        const abResult = this.abogus.generate(queryString);
        const url = `${API_BASE}${endpoint}?${abResult.params}`;
        const headers = this.buildHeaders(ref);

        let resp: Response;
        try {
          resp = await fetch(url, { headers, cf: { cacheTtl: 0 } });
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e));
          if (attempt < 2) { await this.sleep(RETRY_DELAYS[attempt]); continue; }
          break;
        }

        if (RISK_CONTROL_STATUSES.has(resp.status)) {
          const xbResult = this.xbogus.build(`${API_BASE}${endpoint}?${queryString}`);
          try {
            resp = await fetch(xbResult.signedUrl, { headers: this.buildHeaders(ref), cf: { cacheTtl: 0 } });
          } catch (e) {
            lastError = e instanceof Error ? e : new Error(String(e));
          }
          if (RISK_CONTROL_STATUSES.has(resp.status) && attempt < 2) {
            await this.sleep(RETRY_DELAYS[attempt]);
            continue;
          }
          if (!resp.ok) { lastError = new Error(`API ${resp.status}: ${resp.statusText}`); continue; }
        }

        if (!resp.ok) {
          lastError = new Error(`API ${resp.status}: ${resp.statusText}`);
          if (resp.status >= 500 && attempt < 2) { await this.sleep(RETRY_DELAYS[attempt]); continue; }
          break;
        }

        const text = await resp.text();
        if (!text || text.trim() === "") {
          if (attempt < 2) { await this.sleep(RETRY_DELAYS[attempt]); continue; }
          lastError = new Error("Empty response (anti-bot)");
          break;
        }

        const setCookie = resp.headers.get("set-cookie");
        if (setCookie) {
          for (const part of setCookie.split(",")) {
            const m = part.match(/([^=;]+)=([^;]+)/);
            if (m) this.cookies[m[1].trim()] = m[2].trim();
          }
        }

        try {
          return JSON.parse(text) as Record<string, unknown>;
        } catch {
          lastError = new Error("Invalid JSON response");
          if (attempt < 2) { await this.sleep(RETRY_DELAYS[attempt]); continue; }
          break;
        }
      }
    }
    throw lastError || new Error("All request attempts failed");
  }

  async signedPost(
    endpoint: string,
    params: Record<string, string>,
    body: Record<string, string>,
    aid: number = 6383,
    referer: string = ""
  ): Promise<Record<string, unknown>> {
    await this.ensureTokens();
    const baseParams = this.buildBaseParams(aid);
    const allParams = { ...baseParams, ...params };
    const queryString = this.buildQueryString(allParams);
    const bodyString = this.buildQueryString(body);
    const abResult = this.abogus.generate(queryString, bodyString);
    const url = `${API_BASE}${endpoint}?${abResult.params}`;
    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      Referer: referer || DEFAULT_REFERER,
      Accept: "*/*",
      "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: this.getCookieString(),
    };
    const resp = await fetch(url, { method: "POST", headers, body: bodyString, cf: { cacheTtl: 0 } });
    if (!resp.ok) throw new Error(`API POST failed: ${resp.status}`);
    return (await resp.json()) as Record<string, unknown>;
  }

  async getVideoDetail(awemeId: string, aid: number = 6383): Promise<VideoDetail | null> {
    const data = await this.signedGet("/aweme/detail/", { aweme_id: awemeId }, aid);
    return (data["aweme_detail"] as VideoDetail) || null;
  }

  async getUserPosts(secUid: string, maxCursor: number = 0, count: number = 18): Promise<PagedResponse> {
    const data = await this.signedGet("/aweme/post/", {
      sec_user_id: secUid,
      max_cursor: String(maxCursor),
      count: String(count),
      locate_query: "false",
      show_live_replay_strategy: "1",
      need_time_list: "1",
      time_list_query: "0",
      whale_cut_token: "",
      cut_version: "1",
      publish_video_strategy_type: "2",
    });
    return this.parsePagedResponse(data);
  }

  async getUserFavorites(secUid: string, maxCursor: number = 0, count: number = 20): Promise<PagedResponse> {
    const data = await this.signedGet("/aweme/favorite/", {
      sec_user_id: secUid,
      max_cursor: String(maxCursor),
      count: String(count),
    });
    return this.parsePagedResponse(data);
  }

  async getMixDetail(mixId: string): Promise<Record<string, unknown> | null> {
    const data = await this.signedGet("/mix/detail/", { mix_id: mixId });
    return (data["mix_info"] as Record<string, unknown>) || null;
  }

  async getMixAwemes(mixId: string, cursor: number = 0, count: number = 20): Promise<PagedResponse> {
    const data = await this.signedGet("/mix/aweme/", {
      mix_id: mixId,
      cursor: String(cursor),
      count: String(count),
    });
    return this.parsePagedResponse(data);
  }

  async getMusicDetail(musicId: string): Promise<Record<string, unknown> | null> {
    const data = await this.signedGet("/music/detail/", { music_id: musicId });
    return (data["music_info"] as Record<string, unknown>) || null;
  }

  async getHotSearchBoard(): Promise<Record<string, unknown>> {
    return this.signedGet("/hot/search/list/", { detail_list: "1", source: "6" });
  }

  async searchAweme(
    keyword: string,
    offset: number = 0,
    count: number = 10,
    sortType: number = 0,
    publishTime: number = 0
  ): Promise<PagedResponse> {
    const isFilterSearch = sortType > 0 || publishTime > 0 ? "1" : "0";
    const data = await this.signedGet("/general/search/single/", {
      keyword,
      search_channel: "aweme_video_web",
      sort_type: String(sortType),
      publish_time: String(publishTime),
      offset: String(offset),
      count: String(count),
      search_source: "normal_search",
      query_correct_type: "1",
      is_filter_search: isFilterSearch,
    });
    const dataList = (data["data"] as Array<Record<string, unknown>>) || [];
    const items = dataList.map((d) => d["aweme_info"] as VideoDetail).filter(Boolean);
    return {
      items,
      has_more: Boolean(data["has_more"]),
      max_cursor: Number(data["max_cursor"] || 0),
      status_code: Number(data["status_code"] || 0),
      raw: data,
    };
  }

  private parsePagedResponse(data: Record<string, unknown>): PagedResponse {
    const items = ((data["aweme_list"] as VideoDetail[]) || []).filter(Boolean);
    return {
      items,
      has_more: Boolean(data["has_more"]),
      max_cursor: Number(data["max_cursor"] || 0),
      status_code: Number(data["status_code"] || 0),
      raw: data,
    };
  }
}
