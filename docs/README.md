# 交互学习网页编辑器开发文档

这组文档是项目开发的统一基线。所有实现、评审和验收都应先对照这里的范围与标准，避免在第一版中同时引入过多功能。

## 文档目录与使用方式

| 文件 | 用途 | 何时使用 |
| --- | --- | --- |
| [01-product-requirements.md](./01-product-requirements.md) | 产品目标、第一版范围、用户流程和验收口径 | 开始需求、拆任务、判断是否越界时 |
| [02-technical-architecture.md](./02-technical-architecture.md) | 技术选型、项目边界、数据流和安全约束 | 设计模块、选依赖、实现文件写回时 |
| [03-design-specification.md](./03-design-specification.md) | 极简 UI、交互、响应式预览和可编辑标识规范 | 设计页面、实现组件、做 UI 评审时 |
| [04-execution-plan.md](./04-execution-plan.md) | 分阶段开发顺序、每阶段产物、验收标准和停止条件 | 排期、开发、提交阶段成果时 |
| [05-ai-api-security.md](./05-ai-api-security.md) | 用户自带 API、AI 代码修改、隐私和变更确认标准 | 接入 AI、处理密钥、生成代码补丁时 |
| [06-quality-checklist.md](./06-quality-checklist.md) | 手工测试、回归检查和发布前检查表 | 每个阶段完成和发布前 |
| [07-progress-and-acceptance.md](./07-progress-and-acceptance.md) | 当前进度、可验收功能、已知限制和下一步 | 每次查看项目状态时 |
| [08-delivery-acceptance-standard.md](./08-delivery-acceptance-standard.md) | 第一版交付边界、必须通过的验收操作和不合格条件 | 判断一个版本能否交付时 |
| [09-version-2-scope-and-acceptance.md](./09-version-2-scope-and-acceptance.md) | 第二版功能范围、阶段顺序和交付标准 | 第一版验收后规划第二版时 |
| [11-windows-installer.md](./11-windows-installer.md) | Windows 安装包的构建方式、产物位置和发布限制 | 构建、验证或分发桌面安装包时 |
| [12-editing-usability-requirements.md](./12-editing-usability-requirements.md) | 字号编辑、拖动确认、元素缩放、应用内文件切换需求（已确认） | 用户确认本轮需求及后续实施验收时 |
| [13-project-picker-and-theme.md](./13-project-picker-and-theme.md) | 启动直达编辑、自动发现与手动导入项目、黑白主题 | 查看项目选择与外观设置行为及验收记录时 |
| [14-device-preview.md](./14-device-preview.md) | 华为 Pura 70 Pro+ 参考预设、自定义宽高与预览校准 | 查看尺寸来源、保存范围和验证记录时 |
| [15-self-check-2026-10-12.md](./15-self-check-2026-10-12.md) | 自查问题、修复、回归结果与剩余限制 | 查看当前可靠性和安装包差异时 |
| [16-dynamic-feedback-save.md](./16-dynamic-feedback-save.md) | 动态答题提示保存、旧规则修复与服务器更新 | 遇到编辑位置保存后恢复、提示重新生成时 |
| [18-edit-scope.md](./18-edit-scope.md) | 素材修改的当前画面、指定画面、全部画面范围 | 需要跨交互状态保留素材调整时 |
| [19-image-resizing.md](./19-image-resizing.md) | 自由调整宽高、锁定比例和恢复原图比例 | 图片拉伸变形或需要独立修改宽高时 |
| [20-visibility-and-page-sharing.md](./20-visibility-and-page-sharing.md) | 保持原状态、出现范围、跨网页图片应用与撤销 | 希望素材在指定状态或其他 HTML 中出现时 |
| [21-phone-scope-compatibility.md](./21-phone-scope-compatibility.md) | P70 预览、手机通用范围和旧内核 CSS 回退 | 编辑器与真机网页显示不一致时 |

## 当前执行原则

最新功能：[点击后定格与编辑暂停](./29-freeze-editing.md)（0.1.4）。
修复记录：[测试中意外重置](./30-test-progress-preservation.md)（0.1.5）。
当前定格方式：[按下立即定格](./31-immediate-freeze.md)（0.1.6）。
选择修复：[SVG 内部素材选择修复](./32-svg-object-selection.md)（0.1.7）。
几何同步：[SVG 组件跨画面几何同步](./33-svg-scene-geometry.md)（0.1.8）。
当前版本：[购物篮组件与真实画面切换修复](./34-basket-component-and-native-scene.md)（0.1.9）。

1. 先完成单个主题单元的稳定编辑闭环，再扩展多页面、基础交互和 AI。
2. 第一版的主价值是快速微调 HTML/CSS 页面；AI 用于复杂 JavaScript 逻辑，不替代简单拖拽。
3. 所有源文件写回都必须可预览、可撤销、可恢复；AI 修改必须先展示差异并由用户确认。
4. 新功能必须说明它属于哪个阶段，并通过对应验收标准后才能进入下一阶段。
5. 不默认设计课程目录、章节树、时间轴或复杂资源中心。一个项目首先代表一个主题单元。

## 第一条开发切片

目标是完成一个可运行的最小闭环：打开一个本地 HTML/CSS/JS 主题单元项目，在安全预览区显示页面，选中带有 `data-editor-id` 的元素，调整字体大小或位置，预览修改，确认后保存，并能撤销和恢复。

完成这条切片前，不开发 AI 编码、多页面管理、复杂交互编排或模板市场。
