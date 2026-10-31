# 花信 · 手势粒子花园

一朵由摄像头手势驱动的 GPU 粒子粉玫瑰。握拳时粒子收拢成带花茎与两片叶子的花苞；手掌渐张，四层花瓣自内向外舒展；完全张开时外层花瓣散作覆盖画布的粉白星场——**聚是一朵花，散是漫天星**。

当前为项目首个版本，只含「花信」一朵花与配套工程。第二朵花将在后续版本加入。

## 目录结构

```
.
├── index.html                    入口引导页
├── versions/rose/
│   ├── index.html                页面结构
│   ├── assets/style.css          视觉与响应式
│   ├── src/main.js               交互、状态、降级
│   ├── src/scene.js              Three.js 场景与着色器
│   ├── src/flower.js             粒子几何
│   ├── src/gesture.js            MediaPipe 手势
│   ├── README.md                 版本说明
│   └── creative/BRIEF.md         创作思路与方法指导
├── scripts/fetch-assets.sh       共享资源下载脚本
├── .github/workflows/pages.yml   GitHub Pages 构建与发布
├── CREDITS.md                    第三方许可与参考项目
└── .nojekyll
```

`vendor/`（Three.js、MediaPipe、GSAP）与 `models/`（手部关键点模型）是构建产物，共约 50MB，不提交进 Git，由 `scripts/fetch-assets.sh` 在首次运行与每次构建时获取。

## 本地运行

```bash
cd particle-flora
bash scripts/fetch-assets.sh
python -m http.server 8080
# http://localhost:8080/
```

摄像头只在 `localhost` 或 HTTPS 下启用。

## 操作

- **手势**：点击「启用手势」并授权摄像头；握拳收拢、张开绽放。取景框只显示手部骨架，不显示摄像头画面。
- **手动**：拖动「开合」、在画布上下拖动、`1/2/3` 直达形态、空格切换、`C` 摄像头、`H` 隐藏界面、`R` 复位。
- **数量**：桌面 4,000–30,000、手机 3,000–16,000，实时重建并保留开合状态。
- 摄像头拒绝、无设备、非安全上下文或模型加载失败时自动回到手动模式，画布不中断。

## 技术结构

1. **一个 BufferGeometry**：每个粒子预存花苞、花冠、星场三套位置，顶点着色器按开合度连续插值，单 draw call。
2. **手势比例法**：四指「指尖到手腕 / 指节到手腕」比值 + 拇指加权，不受手掌大小与旋转影响。
3. **One Euro Filter + 临界阻尼弹簧**（`k=210, c=29`）：约 0.2 秒到位且不过冲。
4. **手动优先**：手动操作后 2.4 秒内手势不抢回控制权。
5. **降级**：WebGL 2 检测、摄像头失败回退、`file://` 提示、`prefers-reduced-motion`、标签页隐藏暂停。

## 文档

- [花信 README](versions/rose/README.md)
- [花信创作手记](versions/rose/creative/BRIEF.md)
- [Credits](CREDITS.md)

## 路线

- `v1.0.0` 花信：单花版本与基础工程（当前）
- 后续：新增第二个版本、整站入口、项目级创作文档与版本记录

## 隐私与兼容

- 摄像头影像只在浏览器本地处理，不上传、不录制、不显示。
- 需要 WebGL 2；推荐 Chrome / Edge / Safari 16.4+。
- 线上构建会把 `vendor/` 与 `models/` 一并打包，运行时不请求第三方 CDN。
