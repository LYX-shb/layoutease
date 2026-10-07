# 主题单元编辑器

Windows 桌面应用，用于打开和微调 HTML、CSS、JavaScript 交互学习网页。

## 当前功能

- 打开本地主题单元项目，预览和切换已有 HTML 页面。
- 编辑元素位置、文字、字号、颜色、尺寸和间距，替换图片。
- 电脑、平板、手机竖屏和手机横屏预览。
- 编辑与测试模式、保存、撤销/重做、项目版本快照和恢复。
- 基础交互配置，以及用户自带 API 的 AI 代码修改流程。

当前版本为 `0.1.0`。自动化检查已通过；完整 Windows 桌面操作及真实 AI API 验收仍待完成，详见 [项目进度与验收记录](docs/07-progress-and-acceptance.md)。

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

安装包输出到 `release/Theme-Unit-Editor-0.1.0-Setup.exe`。该目录不提交到 Git。安装包尚未代码签名，具体说明见 [Windows 安装包文档](docs/11-windows-installer.md)。

## 开发文档

从 [docs/README.md](docs/README.md) 查看产品需求、技术方案、设计规范、开发计划和验收标准。

API 密钥由应用保存在本机安全存储中，不要把真实密钥、用户课件或本地环境配置提交到仓库。
