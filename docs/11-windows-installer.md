# Windows 安装包

项目现名为 **LayoutEase**。后续构建的产品名、快捷方式名均为 LayoutEase，安装包命名为 `LayoutEase-<版本号>-Setup.exe`。下文的 0.1.10 安装包是更名前发布的历史产物，文件名与包内显示名保留原样。

当前版本为 0.1.10（2026-10-29），修复 11.2 中使用 SVG 组 ID 的组件无法独立选中和移动的问题。当前安装包为 `release/Theme-Unit-Editor-0.1.10-Setup.exe`，已在本机覆盖安装，通过 [GitHub Releases](https://github.com/LYX-shb/layoutease/releases/tag/v0.1.10) 分发。功能与检查记录见 [SVG ID 组件编辑修复](./35-svg-id-component-editing.md)。下文包含早期版本的安装验证记录。

## 构建

在 Windows 项目根目录安装 npm 依赖后运行：

```powershell
npm install
npm run package:win
```

脚本先执行 TypeScript 检查和 Vite 生产构建，再由 electron-builder 生成 x64 NSIS 安装程序。打包使用 `node_modules/electron/dist` 中已安装的 Electron 运行文件，不需要为打包重复下载 Electron 压缩包。

## 产物与使用

- 安装程序：`release/Theme-Unit-Editor-0.1.10-Setup.exe`
- 解包后的应用目录：`release/win-unpacked/`
- 安装程序允许选择安装位置，并创建开始菜单和桌面快捷方式。
- 安装并打开后，选择包含 `index.html` 的主题单元项目文件夹。

每次发布前应运行 `npm test`、`npm run typecheck` 和 `npm run package:win`，确认安装程序存在且大小大于 0。不要把 `release/` 里的应用目录或安装包作为运行时依赖；它们可以从源码重新构建。

## 已知限制

- 当前安装程序没有代码签名证书。Windows SmartScreen 或 Defender 可能提示未知发布者；应只从可信来源分发。
- 0.1.3 已通过安装程序替换当前用户的 0.1.2，安装后的 ASAR 与构建产物哈希一致，桌面窗口启动并正常响应。打开项目、编辑、保存和重启后的数据持久化仍需在目标项目上验收。
- 版本号目前为 `0.1.10`；后续发布前要同步更新 `package.json` 和 `package-lock.json` 中的项目版本号并重新构建。
