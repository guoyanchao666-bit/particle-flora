# 粒子花谱 · 手势双生花

两个由摄像头手势驱动的粒子花版本。它们共享同一套「手掌开合度 → 一朵花的开合」的交互骨架，但走向完全不同的视觉命题：

| 版本 | 命题 | 默认粒子 | 色彩 |
| --- | --- | --- | --- |
| **花信** `versions/rose/` | 聚是一朵花，散是漫天星 | 13,000（4,000–30,000） | 暖黑、粉玫瑰、暖白 |
| **莲境** `versions/lotus/` | 八万粒子的一池莲花 | 80,000（20,000–120,000） | 纯黑、粉紫 / 蓝紫 / 暖金 |

入口页 `index.html` 提供两个版本的卡片式入口。

- 仓库：<https://github.com/guoyanchao666-bit/particle-flora>
- GitHub Pages：<https://guoyanchao666-bit.github.io/particle-flora/>
- WorkBuddy 预览：<https://particle-flora.app.workbuddy.host/?sharecode=WLWWCF7ZD7>

## 目录结构

```
.
├── README.md
├── CHANGELOG.md                  版本变更记录
├── CREDITS.md                    第三方许可与参考项目
├── index.html                    双版本入口
├── .nojekyll
├── assets/landing.css            入口视觉
├── docs/
│   ├── 01-创作思路.md
│   ├── 02-创作流程.md
│   ├── 03-创作指导.md
│   ├── 04-版本管理与发布.md
│   └── 05-开发日志.md
├── versions/
│   ├── rose/                     花信 · 手势粒子花园
│   │   ├── index.html
│   │   ├── assets/style.css
│   │   ├── src/{main,scene,flower,gesture}.js
│   │   ├── README.md
│   │   └── creative/BRIEF.md
│   └── lotus/                    莲境 · 手势粒子莲花
│       ├── index.html
│       ├── assets/style.css
│       ├── src/{main,scene,lotus,gesture}.js
│       ├── README.md
│       └── creative/BRIEF.md
├── scripts/fetch-assets.sh       运行资源重建脚本（可选）
├── .github/workflows/pages.yml   GitHub Pages 构建与发布
├── models/hand_landmarker.task   手部关键点模型
└── vendor/                       Three.js、MediaPipe（含 WASM）、GSAP
```

`vendor/` 与 `models/` 自 `v2.1.0` 起纳入版本库，仓库克隆后可直接运行，不依赖网络与第三方 CDN。`scripts/fetch-assets.sh` 保留用于资源重建或校验：脚本会跳过已存在的文件，重复执行安全。

## 本地运行

```bash
cd particle-flora
python -m http.server 8080
```

- 入口：<http://localhost:8080/>
- 花信：<http://localhost:8080/versions/rose/>
- 莲境：<http://localhost:8080/versions/lotus/>

摄像头只在 `localhost` 或 HTTPS 下启用。`file://` 直接打开会给出提示。

如果 `vendor/`、`models/` 缺失或需要重建（例如只下载了部分源码）：

```bash
bash scripts/fetch-assets.sh
```

## 操作

- **手势**：点击「启用手势」并授权摄像头；握拳收拢、张开绽放。取景框只显示手部骨架，不显示摄像头画面。
- **手动**：拖动「开合」滑块、在画布上下拖动、`1/2/3` 直达形态、空格切换、`C` 摄像头、`H` 隐藏界面、`R` 复位；莲境另有 `P` 切换配色。
- **数量**：实时调整粒子密度，重建几何时保留当前开合与配色。
- **失败路径**：摄像头拒绝、无设备、非安全上下文、模型加载失败均自动回到手动模式，画布不中断。
- `?still=1` 冻结动画，便于截图与评审。

## 技术结构

两个版本共用一条技术路线：

1. **一个 BufferGeometry**：粒子预存多套位置，顶点着色器按开合度连续插值，单 draw call。
2. **手势比例法**：四指「指尖到手腕 / 指节到手腕」比值 + 拇指加权，不受手掌大小与旋转影响。
3. **One Euro Filter + 临界阻尼弹簧**：慢速抑抖、快速低延迟，约 0.2 秒到位。
4. **手动优先**：手动操作后 2.4 秒内手势不抢回控制权。
5. **数量实时调整**：重建几何并释放旧 GPU 缓冲，保留开合与配色；桌面/手机分档。
6. **降级**：WebGL 2 检测、摄像头失败回退、`file://` 提示、`prefers-reduced-motion`、标签页隐藏暂停。

差异在于形态与渲染：

- 花信使用四层圆瓣 + 花茎 + 叶片 + 星场散射，暖调。
- 莲境使用四层尖瓣 + 莲蓬 + 花丝，三套预存配色与整花跟随，纯黑冷调。

## 文档

**项目级**

- [创作思路](docs/01-创作思路.md) —— 命题、视觉语言、交互哲学与「不做」清单
- [创作流程说明](docs/02-创作流程.md) —— 三个阶段、返工记录、验证矩阵与复盘
- [创作指导](docs/03-创作指导.md) —— 架构、着色器接口、新增一朵花的步骤、参数与检查清单
- [版本管理与发布](docs/04-版本管理与发布.md) —— 语义化版本、提交约定、发版与回滚
- [开发日志](docs/05-开发日志.md) —— 从需求、第一版、修改意见到第二版的完整过程
- [变更日志](CHANGELOG.md)

**版本级**

- [花信 README](versions/rose/README.md) · [花信创作手记](versions/rose/creative/BRIEF.md)
- [莲境 README](versions/lotus/README.md) · [莲境创作手记](versions/lotus/creative/BRIEF.md)

## 版本

| 版本 | 主题 | 说明 |
| --- | --- | --- |
| v1.0.0 | 花信 | 单花版本与基础工程 |
| v2.0.0 | 双生花 | 新增莲境、入口页与文档体系 |
| v2.1.0 | 完整离线 | 运行时资源入库、开发日志、结构整理 |

## 隐私与兼容

- 摄像头影像只在浏览器本地处理，不上传、不录制、不显示。
- 需要 WebGL 2；推荐 Chrome / Edge / Safari 16.4+。
- 运行资源全部自托管，页面不请求第三方 CDN。
- 第三方库与模型许可见 [CREDITS.md](CREDITS.md)。

## 部署

`.github/workflows/pages.yml` 在推送到 `main` 或手动触发时执行：校验运行资源 → 汇总静态站点 → 上传并发布到 GitHub Pages。首次使用需在 **Settings → Pages** 把 Source 设为 **GitHub Actions**。
