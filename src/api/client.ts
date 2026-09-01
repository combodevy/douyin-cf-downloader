/**
 * 抖音 API 客户端（转译自 Python core/api_client.py）
 *
 * 核心能力：
 * - 自动生成 Cookie（ttwid / odin_tt / passport_csrf_token）
 * - a_bogus 签名请求（主力），X-Bogus 自动降级
 * - 双 aid 重试（6383 → 1128）
 * - 作品详情 / 用户作品 / 搜索 / 热搜 接口封装
 */
import { ABogus } from "../crypto/abogus";
import { XBogus } from "../crypto/xbogus";
import { getMsToken } from "../crypto/mstoken";
import type { PagedResponse, VideoDetail } from "../types";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
const DOUYIN_BASE = "https://www.douyin.com";
const API_BASE = "https://www.douyin.com/aweme/v1/web";

export class DouyinApiClient {
  private userAgent: string;
  private cookie: string;
  private abogus: ABogus;
  private xbogus: XBogus;
  private aid: number;

  constructor(userAgent: string = DEFAULT_UA) {
    this.userAgent = userAgent;
    this.aid = 6383;
    this.cookie = this.generateCookie();
    this.abogus = new ABogus(userAgent);
    this.xbogus = new XBogus(userAgent);
  }

  private generateCookie(): string {
    const ttwid = this.randomHex(32);
    const odinTt = this.randomHex(32);
    const csrf = this.randomHex(16);
    return (
      `ttwid=1%7C${ttwid}%7C${Date.now()}%7C${this.randomHex(32)}; ` +
      `odin_tt=${odinTt}; ` +
      `passport_csrf_token=${csrf}; ` +
      `passport_csrf_token_default=${csrf}; ` +
      `msToken=; ` +
      `bd_ticket_guard_client_data=eyJiZC10aWNrZXQtZ3VhcmQtdmVyc2lvbiI6MiwiYmQtdGlja2V0LWd1YXJkLWl0ZXJhdGlvbi12ZXJzaW9uIjoxLCJiZC10aWNrZXQtZ3VhcmQtcmVlLXB1YmxpYy1rZXkiOiJCQzB2QjVnY0J6YjZ0a0d3V25rWkE9PSIsImJkLXRpY2tldC1ndWFyZC13ZWJtYXN0ZXItdmVyc2lvbiI6Mn0=; ` +
      `s_v_web_id=verify_${this.randomHex(24)}; ` +
      `__ac_nonce=01${this.randomHex(20)}; ` +
      `__ac_signature=_02B4Z6wo00f01${this.randomHex(30)}AAIBB; ` +
      `device_platform=webapp; ` +
      `aid=${this.aid}`
    );
  }

  private randomHex(length: number): string {
    const chars = "0123456789abcdef";
    let s = "";
    for (let i = 0; i < length; i++) {
      s += chars[Math.floor(Math.random() * chars.length)];
    }
    return s;
  }

  private buildParams(extra: Record<string, string | number>): string {
    const base: Record<string, string> = {
      device_platform: "webapp",
      aid: String(this.aid),
      channel: "channel_pc_web",
      update_version_code: "170400",
      pc_client_type: "1",
      version_code: "170400",
      version_name: "17.4.0",
      cookie_enabled: "true",
      browser_language: "zh-CN",
      browser_platform: "Win32",
      browser_name: "Edge",
      browser_version: "131.0.0.0",
      browser_online: "true",
      engine_name: "Blink",
      engine_version: "131.0.0.0",
      os_name: "Windows",
      os_version: "10",
      cpu_core_num: "8",
      device_memory: "8",
      platform: "PC",
      downlink: "10",
      effective_type: "4g",
      round_trip_time: "50",
      webid: this.randomHex(19),
      msToken: "",
    };
    for (const [k, v] of Object.entries(extra)) {
      base[k] = String(v);
    }
    return Object.entries(base)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
  }

  private async signedRequest(
    endpoint: string,
    params: Record<string, string | number>,
    body: string = "",
    useXbogus: boolean = false
  ): Promise<Record<string, unknown>> {
    const msToken = await getMsToken();
    const query = this.buildParams({ ...params, msToken });

    let signed: { params: string; userAgent: string };
    if (useXbogus) {
      signed = this.xbogus.generate(query, body);
    } else {
      signed = this.abogus.generate(query, body);
    }

    const url = `${API_BASE}/${endpoint}?${signed.params}`;
    const headers: Record<string, string> = {
      "User-Agent": signed.userAgent,
      Referer: `${DOUYIN_BASE}/`,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: this.cookie.replace("msToken=;", `msToken=${msToken};`),
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9",
    };

    const resp = await fetch(url, {
      method: body ? "POST" : "GET",
      headers,
      body: body || undefined,
    });

    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      return { status_code: -1, status_msg: "invalid json", raw: text };
    }
  }

  async getVideoDetail(awemeId: string): Promise<VideoDetail | null> {
    const params = { aweme_id: awemeId };
    // 先试 a_bogus
    let data = await this.signedRequest("aweme/detail/", params);
    if (data.status_code !== 0 || !data.aweme_detail) {
      // 降级 X-Bogus
      data = await this.signedRequest("aweme/detail/", params, "", true);
    }
    if (data.status_code !== 0 || !data.aweme_detail) {
      // 切换 aid 重试
      this.aid = 1128;
      this.cookie = this.generateCookie();
      data = await this.signedRequest("aweme/detail/", params);
      if (data.status_code !== 0 || !data.aweme_detail) {
        data = await this.signedRequest("aweme/detail/", params, "", true);
      }
      this.aid = 6383;
      this.cookie = this.generateCookie();
    }
    if (data.aweme_detail) {
      return data.aweme_detail as VideoDetail;
    }
    return null;
  }

  async getUserVideos(
    secUid: string,
    cursor: number = 0,
    count: number = 20
  ): Promise<PagedResponse> {
    const params = {
      sec_user_id: secUid,
      max_cursor: cursor,
      count,
      show_live_replay_strategy: "1",
      need_time_list: "1",
      detail_list: "1",
    };
    let data = await this.signedRequest("aweme/post/", params);
    if (data.status_code !== 0) {
      data = await this.signedRequest("aweme/post/", params, "", true);
    }
    return {
      items: (data.aweme_list as VideoDetail[]) || [],
      has_more: Boolean(data.has_more),
      max_cursor: Number(data.max_cursor) || 0,
      status_code: Number(data.status_code),
      raw: data,
    };
  }

  async search(
    keyword: string,
    offset: number = 0,
    count: number = 10,
    sort: number = 0
  ): Promise<PagedResponse> {
    const body = `keyword=${encodeURIComponent(keyword)}&offset=${offset}&count=${count}&search_channel=aweme_general&sort_type=${sort}&publish_time=0&template_id=0&aid=${this.aid}`;
    let data = await this.signedRequest("general/search/single/", {}, body);
    if (data.status_code !== 0) {
      data = await this.signedRequest("general/search/single/", {}, body, true);
    }
    const items: VideoDetail[] = [];
    const dataList = data.data as Array<Record<string, unknown>> | undefined;
    if (dataList) {
      for (const item of dataList) {
        if (item.aweme_info) {
          items.push(item.aweme_info as VideoDetail);
        }
      }
    }
    return {
      items,
      has_more: Boolean(data.has_more),
      max_cursor: Number(data.cursor) || offset + count,
      status_code: Number(data.status_code),
      raw: data,
    };
  }

  async getHotList(): Promise<Array<{ word: string; hot_value: string; rank: number }>> {
    const params = { detail_list: "1" };
    let data = await this.signedRequest("hotsearch/words/", params);
    if (data.status_code !== 0) {
      data = await this.signedRequest("hotsearch/words/", params, "", true);
    }
    const words = data.word_list as Array<Record<string, unknown>> | undefined;
    if (!words) return [];
    return words.map((w, i) => ({
      word: String(w.word || ""),
      hot_value: String(w.hot_value || ""),
      rank: i + 1,
    }));
  }
}
