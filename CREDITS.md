# Credits

## 运行依赖

- **Three.js r180** — MIT License, https://threejs.org/
- **@mediapipe/tasks-vision 1.2.0** — Apache-2.0 License, https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
- **Hand Landmarker 模型** — Google MediaPipe 官方模型包，Apache-2.0，通过 `scripts/fetch-assets.sh` 下载。
- **GSAP 3.15.0** — GreenSock Standard License（大多数网站免费；商业授权见 https://gsap.com/licensing/）。仅用于界面入场与状态文字过渡。
- **字体** — 全部使用系统字体（苹方 / 微软雅黑 / 思源宋体 / 宋体），不加载外部字体。

## 参考项目

以下项目用于比较交互架构；两个版本的实现代码均为本轮重写：

- **sukikeeling/gesture-blooming-flower** — MIT — https://github.com/sukikeeling/gesture-blooming-flower  
  版本一「花信」的形态基线：静态部署、MediaPipe + Three.js、开合度驱动单朵粒子花。
- **FIQTOR/particle-handtracker** — MIT — https://github.com/FIQTOR/particle-handtracker  
  参考了「无摄像头时用滑块降级」的产品思路。
- **ppongtong/gesture-particle** — MIT — https://github.com/ppongtong/gesture-particle  
  参考了弹簧动力学与手势稳定化的思路。
- **longzheng268/Gesture-Controlled-Particles** — MIT — https://github.com/longzheng268/Gesture-Controlled-Particles  
  参考了「粒子从形态散开成场」的状态组织方式。

## 说明

- 两个版本的花瓣、花苞、星场、配色、界面图形均由本项目程序化生成，没有使用外部图片或 3D 资产。
- 摄像头画面不显示也不上传；只在本地用 MediaPipe 提取 21 个手部关键点。
- 用户提供的参考包 `Kimi_Agent_手势花朵绽放(3).zip` 用于了解同类实现与获取本地 Hand Landmarker 模型；其玻璃拟态界面、绿黑配色与双形态插值未沿用。
