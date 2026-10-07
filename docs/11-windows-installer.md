# Windows 安装包

## 构建

在 Windows 项目根目录安装 npm 依赖后运行：

```powershell
npm install
npm run package:win
```

脚本先执行 TypeScript 检查和 Vite 生产构建，再由 electron-builder 生成 x64 NSIS 安装程序。打包使用 `node_modules/electron/dist` 中已安装的 Electron 运行文件，不需要为打包重复下载 Electron 压缩包。

## 产物与使用

- 安装程序：`release/Theme-Unit-Editor-0.1.0-Setup.exe`
- 解包后的应用目录：`release/win-unpacked/`
- 安装程序允许选择安装位置，并创建开始菜单和桌面快捷方式。
- 安装并打开后，选择包含 `index.html` 的主题单元项目文件夹。

每次发布前应运行 `npm test`、`npm run typecheck` 和 `npm run package:win`，确认安装程序存在且大小大于 0。不要把 `release/` 里的应用目录或安装包作为运行时依赖；它们可以从源码重新构建。

## 已知限制

- 当前安装程序没有代码签名证书。Windows SmartScreen 或 Defender 可能提示未知发布者；应只从可信来源分发。
- 成功生成安装文件和检查 ASAR 内容不等同于安装后的桌面 GUI 验收。本次从 `D:\页面编辑器\release` 启动时，当前 Codex 沙箱的 Windows AppContainer ACL 阻止 Electron 读取该目录；这不能证明安装后必然失败，也不能代替真实启动验收。正式交付前还需要在 Windows 桌面上安装并检查启动、打开项目、编辑、保存和重启后的数据持久化。
- 版本号目前为 `0.1.0`，发布新版本前要在 `package.json` 更新版本号并重新构建。
