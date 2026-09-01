/**
 * 媒体提取器（转译自 Python core/downloader_base.py）
 */
import type { DownloadAsset, VideoDetail } from "../types";

const WATERMARK_PATTERNS = [/watermark=1/i, /tplv-dy-water/i, /playwm/i, /watermark/i];

function isWatermarkUrl(url: string): boolean {
  return WATERMARK_PATTERNS.some((p) => p.test(url));
}

function isDirectCdn(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !host.endsWith("douyin.com") && !host.endsWith("iesdouyin.com");
  } catch { return false; }
}

const WINDOWS_RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

function sanitizeFilename(name: string, maxLen: number = 80): string {
  const ILLEGAL_RE = /[<>:"/\\|?*#\u0000-\u001f]/g;
  let safe = name
    .replace(/[\n\r]/g, " ")
    .replace(ILLEGAL_RE, "_")
    .replace(/_+/g, "_")
    .replace(/ +/g, " ");
  safe = safe.replace(/^[._\s-]+|[._\s-]+$/g, "");
  if (safe.length > maxLen) safe = safe.slice(0, maxLen).replace(/[._\s-]+$/g, "");
  const stem = safe.split(".")[0]?.toUpperCase();
  if (stem && WINDOWS_RESERVED.has(stem)) safe = `_${safe}`.slice(0, maxLen);
  return safe || "untitled";
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface ExtractOptions {
  videoQuality?: "highest" | "lowest" | "1080p" | "720p" | "540p" | "480p";
  preferNoWatermark?: boolean;
}

export function extractAssets(detail: VideoDetail, options: ExtractOptions = {}) {
  const title = detail.desc || "未命名作品";
  const author = detail.author?.nickname || "unknown";
  const authorSecUid = detail.author?.sec_uid;
  const createTime = detail.create_time;
  const datePrefix = createTime ? formatDate(createTime) : "";
  const safeTitle = sanitizeFilename(title);
  const baseName = `${datePrefix}_${safeTitle}_${detail.aweme_id}`;
  const isPaid = Boolean(detail.charge_info?.is_charge_content || detail.video?.is_charge_video);
  const coverUrl = detail.video?.cover?.url_list?.[0];
  const mediaType = detectMediaType(detail);

  if (mediaType === "gallery") {
    return { mediaType: "gallery" as const, assets: extractGalleryAssets(detail, baseName), coverUrl, title, author, authorSecUid, createTime, isPaid };
  }
  return { mediaType: "video" as const, assets: extractVideoAssets(detail, baseName, options), coverUrl, title, author, authorSecUid, createTime, isPaid };
}

function detectMediaType(detail: VideoDetail): "video" | "gallery" {
  const imagePost = detail.image_post_info;
  let images: unknown[] | undefined;
  if (imagePost && typeof imagePost === "object") {
    images = (imagePost as { images?: unknown[] }).images || (imagePost as { image_list?: unknown[] }).image_list;
  }
  if (!images) images = detail.images || (detail as { image_list?: unknown[] }).image_list;
  if (images && images.length > 0) return "gallery";

  const GALLERY_TYPES = new Set([2, 68, 150]);
  if (GALLERY_TYPES.has(detail.aweme_type)) {
    const video = detail.video;
    const hasVideo = Boolean(video && (
      video.play_addr || video.play_addr_h264 || video.play_addr_265 ||
      video.play_addr_256 || video.vid || video.download_addr?.uri
    ));
    if (!hasVideo) return "gallery";
  }
  return "video";
}

function extractVideoAssets(detail: VideoDetail, baseName: string, options: ExtractOptions): DownloadAsset[] {
  const assets: DownloadAsset[] = [];
  const video = detail.video;
  if (!video) return assets;

  const selected = pickPreferredPlayAddr(video, options.videoQuality || "highest");
  const candidates = buildVideoUrlCandidates(video, selected);

  const best = candidates[0];
  if (best) {
    assets.push({ type: "video", url: best.url, filename: `${baseName}.mp4`, width: best.width, height: best.height, quality: best.quality, watermark: best.watermark });
  }
  for (let i = 1; i < Math.min(candidates.length, 4); i++) {
    assets.push({ type: "video", url: candidates[i].url, filename: `${baseName}_mirror${i}.mp4`, width: candidates[i].width, height: candidates[i].height, quality: candidates[i].quality, watermark: candidates[i].watermark });
  }
  if (video.cover?.url_list?.[0]) assets.push({ type: "cover", url: video.cover.url_list[0], filename: `${baseName}_cover.jpg`, watermark: false });
  if (detail.music?.play_url?.url_list?.[0]) assets.push({ type: "audio", url: detail.music.play_url.url_list[0], filename: `${baseName}_music.mp3`, watermark: false });
  if (detail.author?.avatar_larger?.url_list?.[0]) assets.push({ type: "avatar", url: detail.author.avatar_larger.url_list[0], filename: `${baseName}_avatar.jpg`, watermark: false });
  return assets;
}

interface VideoCandidate { url: string; width?: number; height?: number; quality?: string; watermark: boolean; direct: boolean; }

function pickPreferredPlayAddr(video: NonNullable<VideoDetail["video"]>, quality: string) {
  const bitRates = video.bit_rate || [];
  if (bitRates.length === 0) return video.play_addr ? { url_list: video.play_addr.url_list } : null;

  if (quality === "lowest") {
    const sorted = [...bitRates].sort((a, b) => a.bit_rate - b.bit_rate);
    return { url_list: sorted[0].play_addr.url_list, width: sorted[0].play_addr.width, height: sorted[0].play_addr.height, quality: "lowest" };
  }
  if (quality === "highest") {
    const sorted = [...bitRates].sort((a, b) => {
      const aShort = Math.min(a.play_addr.width || 0, a.play_addr.height || 0);
      const bShort = Math.min(b.play_addr.width || 0, b.play_addr.height || 0);
      if (bShort !== aShort) return bShort - aShort;
      return b.bit_rate - a.bit_rate;
    });
    return { url_list: sorted[0].play_addr.url_list, width: sorted[0].play_addr.width, height: sorted[0].play_addr.height, quality: "highest" };
  }
  const target = parseInt(quality);
  if (!isNaN(target)) {
    const sorted = [...bitRates].sort((a, b) => {
      const aShort = Math.min(a.play_addr.width || 0, a.play_addr.height || 0);
      const bShort = Math.min(b.play_addr.width || 0, b.play_addr.height || 0);
      return Math.abs(aShort - target) - Math.abs(bShort - target);
    });
    return { url_list: sorted[0].play_addr.url_list, width: sorted[0].play_addr.width, height: sorted[0].play_addr.height, quality };
  }
  return { url_list: bitRates[0].play_addr.url_list };
}

function buildVideoUrlCandidates(video: NonNullable<VideoDetail["video"]>, selected: { url_list: string[]; width?: number; height?: number; quality?: string } | null): VideoCandidate[] {
  const candidates: VideoCandidate[] = [];
  const seen = new Set<string>();
  const add = (url: string, meta: { width?: number; height?: number; quality?: string }) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push({ url, width: meta.width, height: meta.height, quality: meta.quality, watermark: isWatermarkUrl(url), direct: isDirectCdn(url) });
  };

  if (selected) for (const url of selected.url_list) if (isDirectCdn(url) && !isWatermarkUrl(url)) add(url, selected);
  if (selected) for (const url of selected.url_list) if (!isDirectCdn(url) && !isWatermarkUrl(url)) add(url, selected);
  if (video.play_addr_h264) for (const url of video.play_addr_h264.url_list) if (!isWatermarkUrl(url)) add(url, {});
  if (video.play_addr) for (const url of video.play_addr.url_list) add(url, {});
  if (selected) for (const url of selected.url_list) if (isWatermarkUrl(url)) add(url, selected);

  candidates.sort((a, b) => {
    if (a.watermark !== b.watermark) return a.watermark ? 1 : -1;
    if (a.direct !== b.direct) return a.direct ? -1 : 1;
    return 0;
  });
  return candidates;
}

function extractGalleryAssets(detail: VideoDetail, baseName: string): DownloadAsset[] {
  const assets: DownloadAsset[] = [];
  const images = detail.images || (detail.image_post_info?.images as Array<Record<string, unknown>> | undefined) || [];
  images.forEach((img, idx) => {
    const urls = collectImageUrls(img as Record<string, unknown>);
    const best = urls[0];
    if (best) {
      const ext = inferImageExt(best.url);
      assets.push({ type: "image", url: best.url, filename: `${baseName}_${String(idx + 1).padStart(2, "0")}${ext}`, width: best.width, height: best.height, watermark: best.watermark });
    }
  });
  if (detail.video?.cover?.url_list?.[0]) assets.push({ type: "cover", url: detail.video.cover.url_list[0], filename: `${baseName}_cover.jpg`, watermark: false });
  if (detail.music?.play_url?.url_list?.[0]) assets.push({ type: "audio", url: detail.music.play_url.url_list[0], filename: `${baseName}_music.mp3`, watermark: false });
  return assets;
}

interface ImageCandidate { url: string; width?: number; height?: number; watermark: boolean; priority: number; }

function collectImageUrls(img: Record<string, unknown>): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  const seen = new Set<string>();
  const add = (url: string | undefined, priority: number, meta: { width?: number; height?: number } = {}) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push({ url, width: meta.width, height: meta.height, watermark: isWatermarkUrl(url), priority });
  };

  const wfList = img["watermark_free_download_url_list"] as string[] | undefined;
  if (wfList) wfList.forEach((u) => add(u, 0));
  const origin = img["origin_image"] as { url_list?: string[]; width?: number; height?: number } | undefined;
  if (origin?.url_list) origin.url_list.forEach((u) => add(u, 1, { width: origin.width, height: origin.height }));
  const display = img["display_image"] as { url_list?: string[]; width?: number; height?: number } | undefined;
  if (display?.url_list) display.url_list.forEach((u) => add(u, 2, { width: display.width, height: display.height }));
  const urlList = img["url_list"] as string[] | undefined;
  if (urlList) urlList.forEach((u) => add(u, 3));
  const dlUrl = img["download_url"] as string | undefined;
  if (dlUrl) add(dlUrl, 4);
  const dlAddr = img["download_addr"] as { url_list?: string[] } | undefined;
  if (dlAddr?.url_list) dlAddr.url_list.forEach((u) => add(u, 5));
  const dlList = img["download_url_list"] as string[] | undefined;
  if (dlList) dlList.forEach((u) => add(u, 6));
  const ownerWm = img["owner_watermark_image"] as { url_list?: string[] } | undefined;
  if (ownerWm?.url_list) ownerWm.url_list.forEach((u) => add(u, 7));

  candidates.sort((a, b) => {
    if (a.watermark !== b.watermark) return a.watermark ? 1 : -1;
    return a.priority - b.priority;
  });
  return candidates;
}

function inferImageExt(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".webp")) return ".webp";
    if (path.endsWith(".png")) return ".png";
    if (path.endsWith(".gif")) return ".gif";
  } catch { /* ignore */ }
  return ".jpg";
}
