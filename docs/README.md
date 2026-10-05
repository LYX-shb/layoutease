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

## 当前执行原则

1. 先完成单个主题单元的稳定编辑闭环，再扩展多页面、基础交互和 AI。
2. 第一版的主价值是快速微调 HTML/CSS 页面；AI 用于复杂 JavaScript 逻辑，不替代简单拖拽。
3. 所有源文件写回都必须可预览、可撤销、可恢复；AI 修改必须先展示差异并由用户确认。
4. 新功能必须说明它属于哪个阶段，并通过对应验收标准后才能进入下一阶段。
5. 不默认设计课程目录、章节树、时间轴或复杂资源中心。一个项目首先代表一个主题单元。

## 第一条开发切片

目标是完成一个可运行的最小闭环：打开一个本地 HTML/CSS/JS 主题单元项目，在安全预览区显示页面，选中带有 `data-editor-id` 的元素，调整字体大小或位置，预览修改，确认后保存，并能撤销和恢复。

完成这条切片前，不开发 AI 编码、多页面管理、复杂交互编排或模板市场。
