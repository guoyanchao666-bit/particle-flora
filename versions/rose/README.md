# 花信 · 手势粒子花园

> 一朵花，从含苞到星野。

「花信」是一朵由 GPU 粒子构成的粉玫瑰。握拳时所有粒子收拢成带花茎与两片叶子的花苞；手掌渐张，四层花瓣自内向外、向上舒展；完全张开时外层花瓣散作覆盖画布的粉白星场，内层花瓣与花心留在原处——聚是一朵花，散是漫天星。

## 在线预览

- 在线预览：`https://particle-flora.app.workbuddy.host/versions/rose/?sharecode=WLWWCF7ZD7`
- 本仓库内路径：[`versions/rose/`](./)

## 运行

仓库根目录启动静态服务，访问 `/versions/rose/`：

```bash
cd <项目根目录>
python -m http.server 8080
# http://localhost:8080/versions/rose/
```

摄像头需要 `localhost` 或 HTTPS。首次克隆仓库时如果 `vendor/` 与 `models/` 为空，先在仓库根目录执行：

```bash
bash scripts/fetch-assets.sh
```

## 操作

- 点击「启用手势」，允许摄像头；取景框只显示手部骨架，不显示摄像头画面。
- 握拳收拢，张开绽放，手掌移动会轻微带动花朵。
- 手动：拖动「开合」、在本画面上下拖动、按 `1/2/3`、空格、`C`（摄像头）、`H`（隐藏界面）、`R`（复位）。
- 数量滑块实时调整粒子密度：桌面 4,000–30,000，手机 3,000–16,000，步进 1,000；默认桌面 13,000、手机 8,000。
- 数量变化只重建粒子几何，保留当前开合、视差与动画状态。

## 形态

| 开合 | 形态 | 画面 |
| --- | --- | --- |
| 0–20% | 含苞 | 螺旋包裹的花苞、弯曲花茎、两片叶子与花萼 |
| 20–82% | 舒展 | 四层花瓣展开，外层低垂、内层合抱，花心透出暖白 |
| 82–100% | 星野 | 外层花瓣散成覆盖视口的星场，中层保留一部分 |

## 实现

- Three.js 单 `BufferGeometry`，每个粒子同时保存花苞、花冠、星场三套位置，在顶点着色器内连续插值。
- 四层参数化花瓣，5–7 瓣一层；另有花蕊、花萼、花托、花茎和两片叶子。
- 开合由 `k=210, c=29` 的临界阻尼弹簧追踪，手势信号先经 One Euro Filter。
- 单手 21 点手势，开合度采用「指尖到手腕 / 指节到手腕」比例，不依赖手腕旋转。
- 单 draw call；像素比自适应；标签页隐藏时暂停渲染。
- 外部依赖：Three.js r180、MediaPipe Tasks Vision 1.2.0、GSAP 3.15（仅界面入场）。

更完整的设计与方法说明见 [`creative/BRIEF.md`](./creative/BRIEF.md)。

## 浏览器与降级

- 需要 WebGL 2；无 WebGL 时显示静态线稿与说明。
- 摄像头拒绝、无设备、非安全上下文、模型失败时自动回到手动模式。
- `file://` 打开会提示改用本地服务器。
- 支持 `prefers-reduced-motion`。

## 目录

```
index.html           页面结构
assets/style.css     视觉与响应式
src/main.js          交互、状态、降级
src/scene.js         Three.js 场景与着色器
src/flower.js        粒子几何
src/gesture.js       MediaPipe 手势
creative/BRIEF.md    创作思路与方法指导
```
