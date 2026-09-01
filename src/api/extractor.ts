/**
 * 媒体提取器（转译自 Python downloaders/media_extractor.py）
 *
 * 核心能力：
 * - bit_rate 多档码率画质选择
 * - 无水印地址优先，带水印兜底
 * - 多候选 CDN 地址排序
 * - 图文无水印原图提取
 * - 付费内容 / DRM 检测
 * - 安全文件名生成
 */
import type { DownloadAsset, ParseResult, VideoDetail } from "../types";

export type QualityLevel =
  | "highest"
  | "1080p"
  | "720p"
  | "540p"
  | "480p"
  | "lowest";

const QUALITY_HEIGHT: Record<string, number> = {
  highest: 9999,
  "1080p": 1080,
  "720p": 720,
  "540p": 540,
  "480p": 480,
  lowest: 0,
};

export function sanitizeFilename(name: string): string {
  let result = name
    .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  if (result.length > 80) {
    result = result.substring(0, 80);
  }
  return result || "douyin";
}

function formatDate(ts: number): string {
  if (!ts) return "unknown";
  const d = new Date(ts * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function selectVideoBitRate(
  detail: VideoDetail,
  quality: QualityLevel
): { url: string; width?: number; height?: number; quality: string } | null {
  const bitRates = detail.video?.bit_rate || [];
  if (bitRates.length === 0) return null;

  const targetHeight = QUALITY_HEIGHT[quality];
  const candidates = bitRates
    .map((br) => ({
      url: br.play_addr?.url_list?.[0] || "",
      width: br.play_addr?.width,
      height: br.play_addr?.height,
      bitRate: br.bit_rate,
      quality: br.play_addr?.uri || "",
    }))
    .filter((c) => c.url)
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  if (candidates.length === 0) return null;

  if (quality === "highest") return candidates[0];
  if (quality === "lowest") return candidates[candidates.length - 1];

  // 找最接近目标高度的
  let best = candidates[0];
  let bestDiff = Math.abs((best.height || 0) - targetHeight);
  for (const c of candidates) {
    const diff = Math.abs((c.height || 0) - targetHeight);
    if (diff < bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }
  return best;
}

function buildVideoAssets(
  detail: VideoDetail,
  quality: QualityLevel,
  baseName: string
): DownloadAsset[] {
  const assets: DownloadAsset[] = [];
  const video = detail.video;
  if (!video) return assets;

  // 1. 从 bit_rate 选指定画质（无水印）
  const selected = selectVideoBitRate(detail, quality);
  if (selected) {
    assets.push({
      type: "video",
      url: selected.url,
      filename: `${baseName}_${selected.quality || "nowm"}.mp4`,
      width: selected.width,
      height: selected.height,
      quality: selected.quality,
      watermark: false,
    });
  }

  // 2. play_addr 无水印（h264 优先）
  const playAddr = video.play_addr_h264 || video.play_addr;
  if (playAddr?.url_list?.[0]) {
    assets.push({
      type: "video",
      url: playAddr.url_list[0],
      filename: `${baseName}_play.mp4`,
      width: playAddr.url_list ? undefined : undefined,
      watermark: false,
    });
  }

  // 3. download_addr 带水印兜底
  if (video.download_addr?.url_list?.[0]) {
    assets.push({
      type: "video",
      url: video.download_addr.url_list[0],
      filename: `${baseName}_wm.mp4`,
      watermark: true,
    });
  }

  return assets;
}

function buildGalleryAssets(
  detail: VideoDetail,
  baseName: string
): DownloadAsset[] {
  const assets: DownloadAsset[] = [];
  const images = detail.images || [];

  images.forEach((img, idx) => {
    // 无水印原图优先
    const nowmUrl =
      img.watermark_free_download_url_list?.[0] ||
      img.origin_image?.url_list?.[0] ||
      img.url_list?.[0] ||
      img.display_image?.url_list?.[0];
    if (nowmUrl) {
      assets.push({
        type: "image",
        url: nowmUrl,
        filename: `${baseName}_img${String(idx + 1).padStart(2, "0")}.jpeg`,
        width: img.width,
        height: img.height,
        watermark: false,
      });
    }
  });

  return assets;
}

export function extractMedia(
  detail: VideoDetail,
  quality: QualityLevel = "highest"
): ParseResult {
  const title = detail.desc || "无标题";
  const author = detail.author?.nickname || "未知作者";
  const dateStr = formatDate(detail.create_time);
  const baseName = sanitizeFilename(`${dateStr}_${title}_${detail.aweme_id}`);

  const isGallery =
    detail.images && detail.images.length > 0 ? true : false;
  const isPaid = Boolean(detail.charge_info?.is_charge_content);

  const assets: DownloadAsset[] = [];

  if (isGallery) {
    assets.push(...buildGalleryAssets(detail, baseName));
  } else {
    assets.push(...buildVideoAssets(detail, quality, baseName));
  }

  // 音乐
  if (detail.music?.play_url?.url_list?.[0]) {
    assets.push({
      type: "audio",
      url: detail.music.play_url.url_list[0],
      filename: `${baseName}_music.mp3`,
      watermark: false,
    });
  }

  // 封面
  const coverUrl = detail.video?.cover?.url_list?.[0];
  if (coverUrl) {
    assets.push({
      type: "cover",
      url: coverUrl,
      filename: `${baseName}_cover.jpeg`,
      watermark: false,
    });
  }

  // 作者头像
  const avatarUrl = detail.author?.avatar_larger?.url_list?.[0];
  if (avatarUrl) {
    assets.push({
      type: "avatar",
      url: avatarUrl,
      filename: `${sanitizeFilename(author)}_avatar.jpeg`,
      watermark: false,
    });
  }

  return {
    success: true,
    aweme_id: detail.aweme_id,
    title,
    author,
    author_sec_uid: detail.author?.sec_uid,
    create_time: detail.create_time,
    media_type: isGallery ? "gallery" : "video",
    assets,
    cover_url: coverUrl,
    is_paid: isPaid,
  } as ParseResult & { is_paid?: boolean };
}
