# PrismGit

[English](README.md) | [Русский](README.ru.md) | **中文** | [Deutsch](README.de.md)

一款基于 Electron + React + TypeScript 构建的现代化跨平台 Git 客户端，灵感来自 SmartGit 20–24，采用 **Ollama-code** 设计语言（Ayu Dark/Light 配色）。

![PrismGit — 历史视图，Ayu Dark](docs/screenshots/history-dark.png)

[![Version](https://img.shields.io/badge/version-2.2.0-blue)](#) [![Tests](https://img.shields.io/badge/tests-1963%20passing-brightgreen)](tests/) [![License](https://img.shields.io/badge/license-MIT-green)](LICENSE) [![AI](https://img.shields.io/badge/AI%20助手-12%20个提供商-purple)](#) [![Locales](https://img.shields.io/badge/语言-EN%20%7C%20RU%20%7C%20ZH%20%7C%20DE-orange)](#)

## 快速开始

```bash
# 克隆并安装
git clone <repo-url>
cd prismgit-electron
make install        # 即使本地 npm 镜像 404 也能存活 — 自动通过 registry.npmjs.org 重试

# 开发
make dev

# 构建当前平台
make package

# 运行测试
make test

# 通过 Docker 进行跨平台构建
make docker-all
```

## 截图

| | |
|:---:|:---:|
| ![历史](docs/screenshots/history-dark.png) | ![更改](docs/screenshots/changes-dark.png) |
| **历史** — 全分支图谱、懒加载、过滤器 | **更改** — 暂存/未暂存分组、拖拽 |
| ![分支](docs/screenshots/branches.png) | ![Pull Requests](docs/screenshots/pulls.png) |
| **分支** — 本地/远程、同步指示器 | **Pull Requests** — GitHub PR + GitLab MR |
| ![评审](docs/screenshots/reviews.png) | ![AI 助手](docs/screenshots/ai-chat.png) |
| **评审** — 4 标签页代码评审 | **AI 助手** — 12+ 提供商、24+ git 工具 |
| ![设置](docs/screenshots/settings.png) | ![历史 — 亮色](docs/screenshots/history-light.png) |
| **设置** — 20+ 主题、4 种界面语言 | **历史 — 亮色主题**（Ayu Light） |

## 2.2.0 版本更新

- **每一个冲突操作现在都会做出反应** — pull（merge/rebase/ff-only）、merge、rebase、cherry-pick、revert、stash pop/apply、git-flow finish、squash-to-branch 以及 3-way 补丁都会跳转到冲突解决器，带有进行中的横幅（继续 / 跳过 / 中止）和操作特定的警告。Git-Flow 绝不会在冲突合并后继续执行；stash pop 不再虚报成功。
- **推送被拒恢复** — non-fast-forward、过期的 force-with-lease、受保护分支和策略性拒绝会打开按原因分类的对话框：「拉取并合并」(+ 自动重试推送)、force-with-lease、「Fetch 后重试」、创建 merge request。PR/MR 列表显示提供商报告的冲突徽章。
- **将一组提交压缩到另一个分支** — 从历史或 Pull Requests/评审中，压缩到已有或新分支，支持冲突处理。
- **计数器审计** — 历史的「Tagged (N)」标签页现在统计*当前视图内*带标签的提交（与过滤器显示一致），每个提交的标签计数精确，分支摘要以俄语正确变格（`1 локальная · 2 локальные · 5 локальных`），侧边栏在启动时跟随恢复的语言设置。
- **密钥管理器**（设置 → 安全）— 列出/复制/替换/删除每个加密保险库条目，仅显示元数据。
- **所有依赖均为最新** — simple-git 4、Vite 8、Vitest 5、Tailwind 4、React 19、Electron 44 — 以及可自愈本地 npm 镜像 404 的 `make install`。
- **性能与稳定性** — 3 秒孤儿进程看门狗、git worker 中的仓库切换与状态刷新、按键级渲染隔离、deb 打包 + 生产冒烟 E2E。

完整历史：[docs/CHANGELOG.zh.md](docs/CHANGELOG.zh.md)

## 功能

### 工作区
- **更改** — 暂存/取消暂存/恢复/忽略/删除/显示（支持拖拽）；可配置的提交日志（设置中的 `git log -N` 节奏与数量）
- **Diff** — 懒加载（20 条 LRU 缓存、150ms 防抖），可编辑（在外部编辑器打开 → 提示暂存）
- **历史** — 带图谱可视化的提交日志、搜索、每个提交的文件树、作者/日期/路径过滤器、多分支选择、带标签提交过滤
- **Annotate** — 内联注解与重叠分析（SmartGit 24）
- **Investigate** — 跟随重命名的文件历史
- **Blame** — 逐行归属与提交颜色

### 冲突处理
- **冲突解决器** — 3 窗格视图（Base | Ours | Theirs），4 种布局；按文件取 ours/theirs；中央窗格可编辑
- **统一的冲突反应矩阵** — 任何冲突操作（pull merge/rebase、merge、rebase、cherry-pick、revert、stash pop/apply、git-flow finish、squash-to-branch、3-way 补丁、AI 自动 stash pop）都会导航到解决器，带有进行中横幅（继续/跳过/中止）+ 冲突区 + 操作特定的提示
- **推送被拒对话框** — non-fast-forward → 拉取并合并 + 自动重试推送；过期 lease → fetch + 重试；受保护分支 → 创建 MR/PR；策略性阻止附说明
- **PR/MR 冲突徽章** — GitLab `merge_status` / GitHub `mergeable` 显示在 PR 列表和评审头部；不可合并时 Merge 按钮禁用并带提示
- **诚实的推送验证** — 推送后 `ls-remote` 检查可捕获静默的服务器端拒绝（钩子、代理、错误分支）

### 工作流
- **Git-Flow** — Feature/Release/Hotfix/Fix/Support 的 start/finish 工作流；AVH 风格前缀配置；初始化横幅；finish 流程在冲突合并处停止（绝不会在冲突后打标签/删分支/推送）
- **Pull Requests** — 统一的 GitHub PR + GitLab MR 管理（列表、创建、打开、批准、合并、关闭）；始终可见的带标签行操作 + 右键菜单；组压缩到分支
- **评审** — 所选 PR/MR 的完整代码评审界面，4 个标签页：
  - **概览** — 描述（markdown 渲染）、摘要统计（文件/提交/评论）
  - **提交** — PR 中的提交列表：sha、消息、作者、日期
  - **文件** — 变更文件与状态徽章、 +/- 计数、unified diff 查看器
  - **讨论** — issue 风格评论 + 评论输入（Cmd/Ctrl+Enter 发送）
- **分布式评审** — 存储在 git notes 中的离线代码评审（`refs/notes/reviews`），可 push/fetch 团队共享
- **压缩到分支** — 在历史中选择一组提交（或 PR），将其作为 ONE 提交落到另一个分支 — 已有或新建分支，支持冲突处理

### 提供商集成
- **统一的提供商存储** — Pull Requests 和评审页面之间的单一共享选择
- **GitHub** — PAT 认证、列表/创建/合并/关闭 PR、获取 PR 详情/文件/提交/评论
- **GitLab** — PAT 认证（云 + 自托管）、列表/创建/合并 MR、获取 MR 详情/变更/备注/提交；按 path_with_namespace 直接查找项目；遵循 3xx 重定向（重命名的项目）
- **提供商芯片** — 页面头部的下拉切换器（AI 助手风格）；从 remote URL 自动检测；手动覆盖跨页面持久化
- **API 调用日志** — 所有 GitHub/GitLab HTTP 请求在输出面板中可见：方法、路径、状态码、耗时

### 引用
- **分支** — 本地/远程、检出、创建、重命名、删除、合并、推送；警告指示器（gone、仅本地、脏）；将一个分支拖到另一个上即可合并
- **标签** — 带注释/轻量级、创建、删除、推送；按正则分组；在提交上进行完整标签管理 — 创建、删除和编辑，无损
- **远程** — 添加/移除/编辑、凭据管理、每个远程的后台 fetch
- **工作树** — 添加、移除、清理（从分支右键菜单）
- **Reflog** — 查看、删除条目、cherry-pick/重置操作、按操作类型过滤
- **贮藏** — push、pop、apply、drop、branch、rename；pop/apply 冲突会打开解决器（保留贮藏）
- **子模块** — init、update、sync、deinit、add
- **Git LFS** — install、pull、push、fetch、track、list、lock/unlock、fsck、untrack
- **可回收** — 在 90 天过期前恢复不可达提交

### SmartGit 24 功能
- **交互式 rebase** — 可视化 todo 编辑器（pick/reword/edit/squash/fixup/drop）
- **冲突解决器** — 3 窗格视图（Base | Ours | Theirs），4 种布局
- **智能视图** — 图谱的预设过滤器（全部、当前分支、我的提交、最近等）
- **重叠列** — 相关提交的可视化
- **查找对象** — 搜索分支/标签/远程（Ctrl+F）
- **拆分提交** — 通过交互式 rebase
- **编辑提交消息** — 内联编辑器
- **Cherry Pick / Revert** — 冲突检测与状态管理
- **宽容的克隆 URL** — 去除 "git clone " 前缀，自动推导文件夹名称

### AI 助手
- **12+ LLM 提供商** — Z.ai（GLM-4-Flash 免费）、OpenRouter（免费模型）、Groq（超快）、Cerebras（每日 100 万免费 token）、Google Gemini、Hugging Face、Mistral、OpenAI、Anthropic、GitHub Models、Ollama（本地）、LM Studio、vLLM、自定义 OpenAI 兼容
- **无限的提供商注册表** — 按需添加任意数量的实例
- **提供商切换器** — 对话中途切换；保留历史
- **对话记忆** — AI 记住同一会话中的先前消息
- **上下文压缩** — 旧消息自动压缩（可配置的最大上下文）
- **token 用量显示** — 每次响应后的输入/输出/上下文计数
- **停止按钮** — 立即中止正在进行的 LLM 调用
- **AI Guard** — 对破坏性 git 操作（reset --hard、force push、clean、amend、stash drop）可配置的允许/确认/拒绝
- **工具限制** — 可配置的最大日志提交数、diff 文件数、上下文大小、请求超时
- **工具使用代理循环** — 24+ 工具：get_status、get_log、get_diff、stage、commit、push、pull、checkout、merge、stash、discard_changes、sync_with_remote、abort_operation、list_repos、clone_repo、init_repo、open_repo、read_file、list_files 等
- **导出聊天日志** 为 Markdown
- **助手回答的 Markdown 渲染** — 代码块、内联代码、粗体、列表
- **起始提示芯片** — 一键常见问题
- **AI 提交消息** — 提交消息中的 `@ai` 占位符 → AI 生成
- **AI 分支名称建议器** — 从变更文件建议 kebab-case 名称
- **流式 AI 响应** — 适用于所有 3 个提供商系列的 SSE 解析器
- **收藏夹** — 保存并重用对话的片段

### 安全
- **加密凭据保险库** — 通过 `safeStorage` 存储 token、远程密码、AI 密钥、SSH 密码
- **密钥管理器**（设置 → 安全） — 仅元数据列出每个保险库条目；按条目复制/替换/删除；手动添加密钥
- **默认提交作者**（设置 → Git） — 应用于新的 clone/init；`commit()` 在未配置身份时回退使用
- **AI Guard** — 破坏性操作的确认门

### 三种窗口样式
- **标准** — 完整侧边栏 + 所有页面
- **日志** — 聚焦历史（隐藏侧边栏）
- **工作区** — 聚焦更改

使用 Ctrl+Shift+1/2/3 或工具栏按钮切换。

### 主题（20+ 配色）
- **Ayu** Dark/Light（默认）、GitHub Light/Dark、Dracula、Monokai、Solarized、Nord、Tokyo Night、Catppuccin Mocha、One Dark、Gruvbox、Slack Dark、Discord、Material、Designer Light、Purple、Simple Light

Ctrl+Shift+T 切换。自动亮/暗跟随操作系统配色。

### 性能与设置
- **Git 性能** — `feature.manyFiles`、`core.fsmonitor`、`fetch.writeCommitGraph` 可在设置 → Git 中配置（通过 GIT_CONFIG 环境覆盖应用，不修改全局配置）
- **可配置日志** — 更改页面提交日志计数（5–100）和刷新间隔（0–300 秒）
- **历史自动刷新** — 可选的周期性 `git log`（最小 30 秒）
- **自动推送** — 可选的周期性推送传出提交
- **每个远程的后台 fetch** — 通过仓库设置中的复选框选择启用
- **自适应轮询** — git 变更后的加速模式（30 秒），否则为基线（120 秒）；窗口失焦时暂停；远程状态 fetch 在专用 utility 进程中运行
- **git worker 中的仓库切换** — 状态、工作区监视和原始读取脱离 UI 线程；3 秒无孤儿看门狗

## 国际化

4 种语言，所有 i18n 域完全对齐：
- **English** (en) — 默认
- **Русский** (ru) — 带有正确的俄语复数形式（`{n|one|few|many}` 引擎：«1 локальная · 2 локальные · 5 локальных»）
- **中文** (zh)
- **Deutsch** (de)

i18n 对齐测试（`tests/unit/i18nParity.test.ts`）确保所有 4 个语言具有相同的键集；复数引擎保持 en/zh/de 的渲染与普通占位符逐字节一致。侧边栏、命令面板和帮助横幅在启动时跟随从设置中恢复的语言。

## 输出面板

输出面板（命令日志）捕获：
- **Git 命令** — 每一个 `git <args>` 子进程及其 stdout/stderr、退出代码、耗时
- **API 调用** — GitHub/GitLab HTTP 请求记录为合成条目（`api gitlab GET /projects/12/merge_requests/5`）
- **用户与系统过滤** — 默认仅显示用户发起的命令
- **搜索** — 按命令文本、stdout 或 stderr 过滤

## 技术栈

- Electron 44、React 19、TypeScript 7、Vite 8
- Tailwind CSS 4、Zustand 5、simple-git 4、electron-store
- 自定义 SVG 图标（无图标库）
- Vitest 5 + Testing Library — 1963 个测试（unit / 使用真实 git 的集成 / 组件）
- 实时 E2E 测试装置 — 冲突反应、推送拒绝、计数器审计（运行中的应用 + 已验证的截图）
- Docker + Wine 用于跨平台构建

## 文档

- [变更日志](docs/CHANGELOG.zh.md) · [EN](docs/CHANGELOG.md) · [RU](docs/CHANGELOG.ru.md) · [DE](docs/CHANGELOG.de.md)
- [架构](docs/ARCHITECTURE.md)（EN） — 系统设计与数据流
- [API 参考](docs/API.md)（EN） — 所有 Git 操作和 IPC 通道
- [贡献](docs/CONTRIBUTING.md)（EN） — 开发设置与指南
- [Docker 构建](docs/DOCKER-BUILD.md)（EN） — 多平台构建指南
- [测试](docs/TESTING.md)（EN） — 测试套件文档

## 项目结构

```
├── electron/                 # 主进程
│   ├── main.ts               # 入口、窗口状态、上下文菜单
│   ├── preload.ts            # Context bridge API
│   ├── menu.ts               # 应用菜单
│   ├── ipc/                  # IPC 处理器
│   ├── services/             # 业务逻辑
│   │   ├── git.ts            # Git 操作（simple-git，6900+ 行）
│   │   ├── github.ts         # GitHub API 客户端
│   │   ├── gitlab.ts         # GitLab API 客户端（自托管 + 云）
│   │   ├── commandLog.ts     # Git 命令 + API 调用日志
│   │   ├── storage.ts        # 持久化设置
│   │   └── watcher.ts        # 自动刷新文件监视器
│   └── types/                # TypeScript API 契约
├── src/                      # 渲染进程
│   ├── App.tsx               # 带懒加载路由和快捷键的根组件
│   ├── components/           # UI 组件（55+ 文件）
│   ├── pages/                # 懒加载页面
│   ├── stores/               # Zustand 状态管理（12 个存储）
│   ├── lib/                  # 工具与业务逻辑
│   └── styles/               # Ayu Dark/Light + 20 主题
├── tests/                    # Vitest 测试套件（1963 个测试）
│   ├── unit/                 # 单元测试（i18n 对齐、gitflow 等）
│   ├── integration/          # 服务集成测试（真实 git）
│   └── components/           # React 组件测试
├── scripts/                  # 构建 + 工具 + 实时 E2E 脚本
├── Dockerfile                # 多平台 Docker 构建
├── docker-compose.yml        # 4 个构建服务
├── Makefile                  # 一体化任务运行器
└── vitest.config.mts         # 测试配置
```

## 键盘快捷键

| 快捷键 | 操作 |
|----------|--------|
| Ctrl+O | 打开仓库 |
| Ctrl+Shift+O | 克隆仓库 |
| Ctrl+Enter | 提交 |
| Ctrl+Shift+P | 推送 |
| Ctrl+Shift+L | 拉取 |
| Ctrl+Shift+F | Fetch / 全局搜索 |
| Ctrl+Shift+G | Git-Flow 对话框 |
| Ctrl+Shift+R | 交互式 rebase |
| Ctrl+Shift+N | 新建分支 |
| Ctrl+Alt+S | 贮藏 |
| Ctrl+Shift+T | 切换主题 |
| Ctrl+Shift+A | AI 助手 |
| Ctrl+Shift+1/2/3 | 窗口样式（标准/日志/工作区） |
| Ctrl+F | 查找对象 |
| Ctrl+K | 命令面板 |
| Esc | 关闭对话框 |

## Docker 构建

所有构建都在 Docker 容器中进行：

```bash
make docker-all          # 所有平台
make docker-linux        # 仅 Linux
make docker-win          # Windows（通过 Wine）
make docker-mac          # macOS Intel
make docker-mac-arm64    # macOS Apple Silicon
```

详见 [docs/DOCKER-BUILD.md](docs/DOCKER-BUILD.md)。

## 许可证

MIT
