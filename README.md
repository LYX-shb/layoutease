# 主题单元编辑器

Windows 桌面应用，用于打开和微调 HTML、CSS、JavaScript 交互学习网页。

## 当前功能

- 打开本地主题单元项目，预览和切换已有 HTML 页面。
- 编辑元素位置、文字、字号、颜色、尺寸和间距，替换图片。
- 电脑、平板、手机竖屏和手机横屏预览。
- 编辑与测试模式、保存、撤销/重做、项目版本快照和恢复。
- 基础交互配置，以及用户自带 API 的 AI 代码修改流程。

当前版本为 `0.1.7`，修复了 SVG 场景总是选中整页、选框拦截后续点击的问题，并支持内部独立素材的位置和尺寸调整。61 项自动化测试及课件副本的 19 项 Electron 检查通过；真实 AI API 验收仍待完成，详见 [本次修复与验证记录](docs/32-svg-object-selection.md)。

Windows 用户可从 [GitHub Releases](https://github.com/LYX-shb/theme-unit-editor/releases/latest) 下载安装包。更新前保存修改并退出旧版，再运行安装程序。

## 本地运行

在 Windows 上安装 Node.js 和 Git，获取源码后运行：

```powershell
npm ci
npm run dev
```

在编辑器中打开包含 `index.html` 的项目文件夹。可以先用 `examples/theme-unit` 体验。

## 检查与打包

```powershell
npm test
npm run typecheck
npm run package:win
```

安装包输出到 `release/Theme-Unit-Editor-0.1.7-Setup.exe`。该目录不提交到 Git，安装包通过 GitHub Releases 分发。安装包尚未代码签名，具体说明见 [Windows 安装包文档](docs/11-windows-installer.md)。

## 开发文档

从 [docs/README.md](docs/README.md) 查看产品需求、技术方案、设计规范、开发计划和验收标准。

API 密钥由应用保存在本机安全存储中，不要把真实密钥、用户课件或本地环境配置提交到仓库。
