/** 类型定义 */
export type UrlType =
  | "video"
  | "gallery"
  | "user"
  | "collection"
  | "music"
  | "live"
  | "live_replay"
  | "short"
  | "lvdetail";

export interface ParsedUrl {
  originalUrl: string;
  type: UrlType;
  aweme_id?: string;
  sec_uid?: string;
  mix_id?: string;
  note_id?: string;
  music_id?: string;
  room_id?: string;
  room_id_kind?: string;
  sec_user_id?: string;
  episode_id?: string;
  replay_id?: string;
}

export interface VideoDetail {
  aweme_id: string;
  desc: string;
  create_time: number;
  aweme_type: number;
  author: {
    nickname: string;
    sec_uid: string;
    uid: string;
    avatar_larger?: { url_list: string[] };
  };
  video?: {
    play_addr?: { url_list: string[]; uri: string };
    play_addr_h264?: { url_list: string[] };
    play_addr_265?: { url_list: string[] };
    play_addr_256?: { url_list: string[] };
    bit_rate?: Array<{
      bit_rate: number;
      play_addr: { url_list: string[]; uri: string; width?: number; height?: number; data_size?: number };
    }>;
    vid?: string;
    download_addr?: { url_list: string[]; uri: string };
    cover?: { url_list: string[] };
    is_charge_video?: boolean;
    is_need_set_cookie?: boolean;
  };
  images?: Array<{
    url_list?: string[];
    origin_image?: { url_list: string[] };
    display_image?: { url_list: string[] };
    watermark_free_download_url_list?: string[];
    download_url_list?: string[];
    width?: number;
    height?: number;
  }>;
  image_post_info?: {
    images?: Array<Record<string, unknown>>;
  };
  music?: {
    title: string;
    play_url?: { url_list: string[] };
  };
  charge_info?: {
    is_charge_content?: boolean;
    has_paid?: boolean;
  };
  [key: string]: unknown;
}

export interface PagedResponse {
  items: VideoDetail[];
  has_more: boolean;
  max_cursor: number;
  status_code: number;
  raw: Record<string, unknown>;
}

export interface DownloadAsset {
  type: "video" | "image" | "audio" | "cover" | "avatar" | "json";
  url: string;
  filename: string;
  width?: number;
  height?: number;
  quality?: string;
  watermark: boolean;
}

export interface ParseResult {
  success: boolean;
  aweme_id?: string;
  title: string;
  author: string;
  author_sec_uid?: string;
  create_time?: number;
  media_type: "video" | "gallery" | "music";
  assets: DownloadAsset[];
  cover_url?: string;
  duration?: number;
  error?: string;
}
