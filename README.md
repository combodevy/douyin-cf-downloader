# douyin-cf-downloader

> 抖音无水印视频 / 图文下载器，基于 Cloudflare Workers 部署，零成本运行。

将开源项目 [jiji262/douyin-downloader](https://github.com/jiji262/douyin-downloader) 的核心反爬签名算法（a_bogus / X-Bogus）从 Python 完整转译为 TypeScript，使其能在 Cloudflare Workers 上以纯前端 + Serverless 的方式运行，无需服务器、无需数据库、完全免费。

## 功能特性

- 无水印视频下载，支持 6 档画质（最高 / 1080p / 720p / 540p / 480p / 最低）
- 图文（图集）下载，无水印原图优先
- 音乐 / 封面 / 作者头像一键下载
- 短链自动解析（`v.douyin.com`）
- 用户主页作品列表浏览（分页加载）
- 关键词搜索（综合 / 最多点赞 / 最新发布）
- 抖音热搜榜实时获取
- 代理下载（绕过 CORS，浏览器内直接保存）
- 付费内容 / DRM 加密自动检测与提示
- 响应式 Web UI，移动端适配

## 技术原理

### 反爬签名

抖音 Web API 的每个请求都必须携带合法签名，否则返回空数据或 403。本项目实现了双签名体系：

| 签名 | 算法 | 用途 |
|------|------|------|
| **a_bogus**（主力） | SM3 国密哈希 + RC4 + 256 元素大数组混淆 + 自定义 Base64 + 浏览器指纹 | 当前抖音 Web 端最新签名 |
| **X-Bogus**（回退） | MD5 + RC4 + 自定义 Base64 | a_bogus 被风控时自动降级 |

辅以动态 msToken 获取（优先从 F2 项目配置拉取真实 token，失败回退随机伪造）和自动生成的 Cookie 体系（ttwid / odin_tt / passport_csrf_token）。

### 下载流程

```
用户输入 URL
    ↓
URL 类型识别（video / gallery / user / collection / music / live）
    ↓
短链解析（如需要）
    ↓
调用 /aweme/v1/web/aweme/detail/（携带 a_bogus 签名）
    ↓
从 bit_rate 多档码率中按配置选择画质
    ↓
构建候选地址链：无水印直连 CDN → 无水印 play 端点 → 带水印兜底
    ↓
返回直链 + 代理下载链接
```

## 项目结构

```
├── src/
│   ├── index.ts              # Workers 入口与 API 路由
│   ├── parser.ts             # URL 解析器（类型识别 + ID 提取）
│   ├── types.ts              # TypeScript 类型定义
│   ├── api/
│   │   ├── client.ts         # 抖音 API 客户端（签名请求 + Cookie 管理）
│   │   └── extractor.ts      # 媒体提取器（画质选择 + 多候选排序）
│   └── crypto/
│       ├── sm3.ts            # SM3 国密哈希算法（GB/T 32905-2016）
│       ├── md5.ts            # MD5 哈希
│       ├── rc4.ts            # RC4 流加密
│       ├── abogus.ts         # a_bogus 签名算法
│       ├── xbogus.ts         # X-Bogus 签名算法
│       └── mstoken.ts        # msToken 动态获取
├── public/
│   └── index.html            # 前端单页应用
├── wrangler.toml             # Cloudflare Workers 配置
├── package.json
├── tsconfig.json
└── README.md
```

## 快速开始

### 前置要求

- Node.js 18+
- 一个 Cloudflare 账号（免费版即可）

### 部署

```bash
# 1. 克隆仓库
git clone https://github.com/combodevy/douyin-cf-downloader.git
cd douyin-cf-downloader

# 2. 安装依赖
npm install

# 3. 构建
npm run build

# 4. 登录 Cloudflare（浏览器弹出授权）
npx wrangler login

# 5. 一键部署
npm run deploy
```

部署成功后，Cloudflare 会返回一个 `https://<项目名>.<用户名>.workers.dev` 地址，直接在浏览器打开即可使用。

### 本地开发

```bash
npm run dev      # 启动本地开发服务器
npm run typecheck # TypeScript 类型检查
npm run build    # 生产构建
```

## API 接口

### 解析单个链接

```
GET /api/parse?url={抖音链接}&quality={highest|1080p|720p|540p|480p|lowest}
```

响应示例：

```json
{
  "success": true,
  "aweme_id": "7300000000000000000",
  "title": "作品标题",
  "author": "作者昵称",
  "media_type": "video",
  "quality": "highest",
  "assets": [
    {
      "type": "video",
      "url": "https://...douyinvod.com/...",
      "filename": "2024-01-01_标题_7300000000000000000.mp4",
      "width": 1080,
      "height": 1920,
      "watermark": false,
      "proxy_url": "/proxy?url=...&filename=..."
    }
  ]
}
```

### 用户作品列表

```
GET /api/user?sec_uid={用户sec_uid}&cursor={游标}&count={数量}
```

### 关键词搜索

```
GET /api/search?q={关键词}&offset={偏移}&sort={0综合|1最多点赞|2最新}
```

### 热搜榜

```
GET /api/hot
```

### 代理下载

```
GET /proxy?url={媒体直链}&filename={保存文件名}
```

## 免费额度

Cloudflare Workers 免费版：

| 项目 | 额度 |
|------|------|
| 每日请求数 | 100,000 |
| 单次请求 CPU 时间 | 10 ms |
| 出站带宽 | 无限 |
| KV / D1 存储 | 1 GB |

个人使用完全足够。

## 与原 Python 项目的差异

| 功能 | Python 原版 | 本项目 |
|------|------------|--------|
| 单视频 / 图文下载 | 支持 | 支持 |
| 用户主页作品列表 | 支持（含浏览器兜底） | 支持（API 分页） |
| 合集 / 音乐下载 | 支持 | 暂未开放 |
| 直播录制 | 支持 | 不支持（Workers 超时限制） |
| 直播回放 | 支持 | 不支持 |
| 评论采集 | 支持 | 暂未开放 |
| 本地文件存储 | 支持 | 不支持（返回直链，浏览器下载） |
| SQLite 增量记录 | 支持 | 可用 D1 替代 |
| Playwright 浏览器兜底 | 支持 | 不支持（无浏览器环境） |

## 注意事项

1. **风控风险**：抖音可能对 Cloudflare IP 段偶发风控。解析失败时可等待几分钟重试，或绑定自定义域名。
2. **大文件下载**：超过约 100MB 的视频建议直接使用返回的直链下载（不走代理），避免 Workers 超时。
3. **付费内容**：付费作品的 `download_addr` 为 CENC 加密，无法直接播放。工具会自动检测并提示，`play_addr` 可能包含试看片段。
4. **合规使用**：请遵守抖音用户协议及相关法律法规，下载内容请勿用于商业用途。

## 致谢

- [jiji262/douyin-downloader](https://github.com/jiji262/douyin-downloader) — 原项目，提供了完整的 Python 实现参考
- [Johnserf-Seed/F2](https://github.com/Johnserf-Seed/f2) — a_bogus 签名算法的逆向来源

## License

MIT
