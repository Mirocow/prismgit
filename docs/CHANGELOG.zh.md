# 更新日志

PrismGit 的所有显著变更都记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，
本项目遵循[语义化版本](https://semver.org/lang/zh-CN/)。

**其他语言：** [English](CHANGELOG.md) · [Русский](CHANGELOG.ru.md) · [Deutsch](CHANGELOG.de.md)

## [2.3.0] - 2026-09-29

### 新增 — 浏览器式前进/后退导航
- **工具栏前进/后退按钮** + Alt+← / Alt+→。独立的导航历史栈只记录用户轨迹；新跳转会截断“前进”尾巴，与真实浏览器一致
- 已列入快捷键速查表（导航分组）

### 新增 — VS Code 风格面板折叠
- **左侧边栏**折叠为 48px 图标栏（工具图标 + 实时变更计数 + 主题/设置置底）；点击展开箭头恢复原宽度，状态持久化
- **History 提交详情面板**（右侧栏）可折叠为 24px 细条，提交图占满全宽

### 新增 — 自定义主题 + 精选主题
- **主题精选为 6 款**（Ayu Light、One Dark、Simple、Material、Discord、亮色窗口+深色侧栏）；旧选择自动迁移到对应精选主题
- **可视化主题编辑器**（«创建主题…»）：15 个颜色输入（表面、文字颜色、强调色、边框、状态色、侧边栏背景）+ 明暗标志 + 实时预览。自定义主题通过专属 `data-theme="custom-*"` 选择器生效，自动派生悬停/反色/边框色阶——文字颜色在所有工具中都会变化
- “侧边栏”背景字段即可搭建“深色侧栏 + 浅色主窗口”（VS Code 风格），侧栏文字可读性自动计算
- 取代了原 JSON 文本框式“主题覆盖”

### 新增 — 每个工具都有快捷键 + 可配置顺序
- 每个工具恰好一个快捷键：Ctrl+1..9（常用）+ Alt+1..9（其余——此前 Alt+1..6 与 Ctrl+1..6 重复）
- **设置 → 界面 → «侧边栏与导航»**：上下移动调整工具顺序（持久化），从空闲槽位下拉重选快捷键（“—”解绑；被抢占的组合自动从原工具释放），可一键重置
- 工具快捷键在文本输入框中也生效（与浏览器一致）

### 新增 — History 的提交上下文
- **«包含此提交的分支»** — 提交卡片中的分支徽标（`git branch --contains` + `-r`，按 SHA 缓存）；点击本地分支即切换到该分支视图
- **一键按作者过滤** — 点击提交卡片中的作者名即设置作者过滤；复制按钮一次拿到“姓名 <邮箱>”

### 修复 — 计数器（第二轮）
- **Branches 汇总**改为显示仓库级总数（此前搜索过滤时数字“缩水”，与 Tags/Stashes 工具不一致）
- **History «С тегами (N)» 徽标**按过滤后的集合计算——启用文本/作者/日期过滤时，数字与点击徽标后的行数完全一致
- **仓库信息对话框**分别显示本地与远程分支数；统计任务新增 `git branch -r` 计数
- 移除 History 中的死加载器（每次刷新都为已不存在的区块执行 stash/reflog 加载）

### 修复 — 失效集成的 401 提示轰炸
- Pull Requests 页中被 GitHub 拒绝的令牌（401 Bad credentials）现在按授权问题处理而非加载失败：零错误提示、页面内显示登录引导、后续进入不再发请求（一次请求取代 3+）
- loadPRs 增加防重复保护（in-flight/last-key）：提供方探测翻转 `loading` 不再触发重复加载；“刷新”按钮是显式重试路径

### 变更 — 设置去重与说明
- **两个“外部工具”面板合并为一个**（diff.tool/merge.tool 名称输入移到其对应命令旁）
- **提交行 guides**：删除了无效的数字输入——“命令”中的选择器是唯一归属
- 易混淆设置新增 **«!» 悬浮说明**：后台检查间隔与范围、reflog 上限、对比度、侧边栏与导航
- AI 面板中硬编码的英文小标题已本地化

## [2.2.0] - 2026-09-28

### 新增 — 每一个冲突操作现在都会做出反应
- **统一的冲突反应矩阵** — pull（merge/rebase/ff-only 策略）、merge、rebase、cherry-pick、revert、stash pop/apply、git-flow 完成（×4 流程）、squash-to-branch、3-way 补丁以及 AI 自动 stash pop 全部跳转到「更改」页的冲突解决器，带有进行中横幅（«Слияние/Rebase/Применяется» + 继续 / 跳过 / 中止）、冲突区块和操作特定的警告提示
- **Git-Flow 绝不会在冲突后继续** — 完成流程在冲突合并处停止：不打标签、不删分支、不在冲突状态下推送
- **诚实的 stash pop/apply** — simple-git 将冲突的 `git stash pop|apply` 视为成功；现在事后状态检查会识别冲突形态，抛出带 `.conflicts` 的类型化错误，保留 stash 条目并打开解决器（以前：成功提示 + 清除选择，而工作区却充满冲突标记）
- 在运行的应用中实测：`scripts/verify-conflict-reactions.mjs` — 17/17（俄语界面）

### 新增 — 推送被拒恢复（远程冲突）
- **PushRejectionDialog** — 被 git 拒绝的推送会打开按原因分类的对话框，每种原因有对应恢复动作：non-fast-forward → «Стянуть и слить» + 自动重试推送；过期的 force-with-lease → fetch + 重新 lease 重试；受保护分支 → 创建 MR/PR；策略性阻止附解释。接入所有推送错误处理点（工具栏 push/sync/Push-To、「提交并推送」、git-flow 完成）
- **修复 IPC 错误过滤器** — `electron/ipc/git.ts` 中的 wrap() 只保留 `error:/fatal:` 行：`! [rejected]` 和 `remote: GitLab:` 行在到达渲染器之前被剥离，因此对话框永远无法打开。现在 rejected]/remote:/hint: 行可以通过
- **PR/MR 冲突徽章** — GitLab `merge_status` / GitHub `mergeable` 显示为行徽章和评审头部徽章；不可合并时 Merge 按钮禁用并带提示
- 在运行的应用中实测：`scripts/verify-push-rejections.mjs` — 16/16（non-FF 对话框 + pull-merge 自动重试、force-with-lease、过期 lease fetch 重试）

### 新增 — 将一组提交压缩到另一个分支
- 在历史中选择提交范围（或从 Pull Requests/评审中选择 PR/MR 组），将其作为 ONE 提交落到另一个分支 — 已有或新建分支，对话框内完整冲突处理
- 旧的 squash API 套件被冲突感知的新套件取代；整 PR squash E2E 保持兼容

### 新增 — 密钥管理器（设置 → 安全）
- **已存密钥区块** — 加密保险库的每个条目都列出（仅元数据：namespace、名称、加密标志），按类别分组：访问令牌、仓库/远程密码、AI 提供商密钥、GitHub、SSH 密码短语
- **每条目的复制 / 替换 / 删除** — 值从不渲染；「复制」将单个值直接送到剪贴板，「替换」存入新值，「删除」移除条目（需确认）
- **添加密钥** — 手动注册一个从第一个字节起就加密存储的密钥（令牌、仓库路径 + 远程名称的远程密码等）
- 新 IPC：`credentials:list` / `credentials:set` / `credentials:delete` / `credentials:reveal`

### 新增 — 默认提交作者（设置 → Git）
- 设置 → 项目 → Git 中的**「默认提交作者」**（gitUserName / gitUserEmail），带「应用到当前仓库」按钮
- 用 PrismGit 创建或克隆的新仓库会自动将身份写入本地 `user.name` / `user.email` — 首次提交不再出现「Please tell me who you are」
- 当 git 因任何地方都没有配置身份而拒绝提交时，`commit()` 会以 `-c` 覆盖参数用默认身份重试一次；否则错误会说明在哪里设置

### 修复 — 计数器（用户可见数字审计）
- **历史 «Tagged (N)» 标签** — N 现在是当前视图内带标签的提交数（与过滤器为当前分支选择显示的完全一致）；工具提示同时携带两个数字（视图内 + 全仓库）。以前：allTags.length — 视图外分支上的标签导致标签页与行数不一致
- **每个提交的 «Теги на этом коммите (N)»** — 只统计指向该提交的标签（一个提交上两个标签 → (2)，名称列出）
- **分支摘要俄语语法** — t() 中新增可选复数管道语法：`{name|one|few|many}` 选择 CLDR 复数形式（«1 локальная · 2 локальные · 5 локальных · 6 тегов»）；en/zh/de 保持简单占位符，渲染逐字节一致
- **侧边栏跟随启动语言** — 导航标签在模块加载时冻结，因此 RU 配置首次启动会显示英文侧边栏直到手动刷新；NAV_ITEMS 现在每次渲染时求值（侧边栏、命令面板、帮助横幅）
- 跨工具计数器同步：在标签页删除标签会立即更新历史标签页
- 在运行的应用中实测：`scripts/verify-counters.mjs` — 17/17，对照 git CLI 基准

### 修复 — 「无法保存设置」（gpg.program）
- 仓库设置 → 签名无法保存：simple-git 阻止 `git config gpg.program`（和其他「不安全」键），除非启用 `allowUnsafeGpgProgram`。`configSet` / `configUnset` 现在检测插件拒绝并在启用了配置写入标志的实例上重试 — GUI 客户端中的显式用户编辑就是意图
- 签名标签页不再无条件写入 `gpg.program`：空字段从 `.git/config` 中取消设置而非写入（同时修复了无法清除的 user.signingkey 和会导致每个提交报「empty ident name not allowed」的危险 `user.name=""` 写入）

### 修复 — GitLab / PR 界面
- **现在可以从 GitLab 仓库创建 MR** — Pull Requests 创建对话框以前即使对 GitLab 仓库也调用 GitHub REST API（必然失败，而 README 却承诺两个提供商都支持「创建」）；现已接入早已存在的 `gitlab:createMergeRequest` IPC — 已通过在应用中创建 v2.2.0 发布 MR 实测验证
- **GitLab apiJson 遵循 3xx 重定向** — 重命名/移动的项目（gitclient → prismgit）以前会以静默 404 破坏 MR 列表
- **Pull Requests 行操作可见且可理解** — 悬停显示的加密图标 → 始终可见的带标签按钮 + 右键菜单（在评审中打开 / 浏览器 / 压缩 / 复制组）

### 修复 — 安装 / 打包
- **`make install` 可在本地 npm 镜像 404 时存活** — `scripts/npm-install-with-retry.sh` 包装 npm install/ci，从 npm 自己的输出读取结果（tee 会吞掉退出码），遇到 E404 自动用 `--registry=https://registry.npmjs.org` 重试一次；EBADENGINE 得到友好的 Node 升级提示；被杀死的运行不可能伪造成功
- deb 打包元数据 + 生产包冒烟 E2E — 在真实机器上可存活的打包

### 修复 — 稳定性
- **退出看门狗** — 关闭不再可能挂起：3 秒硬看门狗，worker 子进程绝不成为孤儿
- **消除仓库切换冻结** — 状态、工作区监视和原始读取在 git worker 中运行；密度修复（v3.6）
- **远程状态 fetch 风暴** — 打破加速循环、杀死挂起的 fetch、轮询与前台队列解耦；远程状态 fetch 移至专用 utilityProcess
- **渲染隔离** — 按键/每 token/每帧级重绘被隔离；移除状态刷新引起的 5 秒全树重绘风暴
- **i18n 布局** — 界面不再因 RU/DE 字符串长度而破坏

### 变更 — 性能：LFS 问题后 git 操作缓慢
- 网络命令（fetch / pull / push / ls-remote）不再运行在每个仓库共享的 simple-git 实例上（`maxConcurrentProcesses: 2`）— 缓慢或挂起的网络命令（不可达的 LFS 服务器、等待输入的凭据对话框、巨型 fetch）以前会占用 2 个队列槽位并阻塞仓库的所有 git 操作
- 所有网络命令以 `GIT_TERMINAL_PROMPT=0` 运行 — 未应答的凭据提示快速失败并给出清晰错误，而不是无形挂起（与推送路径一致）

### 变更 — 依赖（全部最新）
- **simple-git 3 → 4** — 具名导入迁移；驯服新的环境守卫（GIT_* 键的 `allowEnvironment` 契约，经探测固定）
- vite 8.3、vitest 5、@types/node 26、@tauri-apps/* 2.12（React 19 / Electron 44 / TypeScript 7 / Tailwind 4 此前已最新）

### 测试
- **1963 通过**（2.1.0 时为 1009）/ 0 失败 / 34 依赖环境的跳过；tsc 无错误
- 新增层：冲突反应集成套件（真实 bare remote、真正分叉）、推送被拒场景（non-FF、过期 lease、pre-receive 保护模拟）、计数器 E2E、i18n 复数引擎、冲突感知 squash API、企业级 QA 性能套件（monster 仓库生成器、CDP 内存/DOM/FPS + 僵尸审计）
- `tests/integration/gitService.identityConfig.test.ts` — gpg.program 设置/取消、初始化身份、提交回退、无身份错误消息
- `scripts/secrets-smoke.cjs` 扩展了密钥管理器往返检查（仅元数据列表、set+reveal、delete）

---

## 早期版本

| 版本 | 日期 | 简介 |
|--------|------|--------|
| [2.1.0] | 2026-09-13 | AI 助手大修（12 提供商、记忆、流式）、懒加载历史、引导之旅 — [英文完整版](CHANGELOG.md#210---2026-09-13) |
| [2.0.1] | 2026-09-13 | 引导之旅覆盖层定位修复 — [EN](CHANGELOG.md#201---2026-09-13) |
| [4.1.0] / [4.0.0] | 2026-09-09 | AI 工具配置、工具限制 — [EN](CHANGELOG.md) |
| [3.1.0] / [3.0.0] | 2026-09-09 | 早期工具工作版本 — [EN](CHANGELOG.md) |
| [2.0.0] | 2026-09-09 | 基础客户端：历史、更改、分支 — [EN](CHANGELOG.md#200---2026-09-09) |
| [1.0.0] | 2026-09-09 | 首次发布 — [EN](CHANGELOG.md#100---2026-09-09) |
