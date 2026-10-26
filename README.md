# dsh-github-manager

在 [DeepSeek Harness](https://harness.deepseek.com) (dsh) 内登录 GitHub，并给 dsh 一个**按账户区分的 GitHub 访问通道**——管理面板在左侧栏，AI 用同一套账户操作你的仓库、Issue 与 PR。

Sign in to GitHub inside dsh, manage several accounts, and let the AI operate your GitHub through the connected account.

## 它做什么 / What it does

| 能力 | 说明 |
|---|---|
| 左上角入口 | 在左侧栏「插件」「自动化任务」正下方注册「GitHub 管理」入口（`sidebar.panellist`，`order: 11`，紧随内置的插件 `0` 与自动化任务 `10`），点开即管理面板（键控 `main` 页）。 |
| 登录 | Personal Access Token 直接粘贴验证；也支持 OAuth 设备码流程（需自备 OAuth App Client ID）。 |
| 多账户 | 每个账户独立保存（登录名、头像、权限范围、令牌），可设默认账户、刷新、移除。 |
| 面板内管理 | 查看/切换/刷新/移除账户、加载最近仓库并跳转。 |
| 让 AI 操作 | 面板里写下指令点「交给 AI」，直接发到**当前对话**，由 AI 通过 `github_api` 工具用你的账户执行。 |
| 给 AI 的工具 | `github_accounts` / `github_api` 两个 agent 工具，AI 用你的账户调 GitHub REST API。 |

令牌**只保存在本机** dsh 目录（`$DSH_HOME/storages/dsh-github-manager/accounts.json`，权限 `0600`），**永远不会回传给浏览器**——面板只拿到 `gho_…gmmD` 这样的预览。

## 安装 / Install

```bash
# 1. 克隆到固定位置
git clone https://github.com/LLL-lyh0/dsh-github-manager.git

# 2. 写入 profile 的 package.json
#    "dependencies":        { "dsh-github-manager": "link:D:/path/to/dsh-github-manager" }
#    "dsh.profile.bundles": [ ... , "dsh-github-manager" ]

# 3. 链接进 profile 的 node_modules
mklink /J "%USERPROFILE%\.dsh\profiles\<profile>\node_modules\dsh-github-manager" "D:\path\to\dsh-github-manager"
```

然后重启 dsh。左侧栏会出现「GitHub 管理」入口。

## 用法 / Usage

### 面板

面板分两个页签：

**登录** — 粘贴 Personal Access Token（GitHub → Settings → Developer settings → Personal access tokens，至少勾 `repo`），添加后会立刻验证身份与权限范围；或填写 OAuth App 的 Client ID 走设备码流程。

**管理** — 已连接账户（可设默认、刷新、移除）、**让 AI 操作**输入框、最近仓库列表。已登录时会自动停在这一页。

### 让 AI 操作 GitHub

两条路，效果一样：

1. **面板里点按钮** —— 在「管理 → 让 AI 操作」写下要做的事，点「交给 AI」，指令会直接进入当前对话，由 AI 执行。
2. **直接对我说** —— 在对话里说，例如：
   - 「列出我最近的仓库」
   - 「给 LLL-lyh0/dsh-autostart 提一个 issue，标题是…」
   - 「看下这个 PR 的改动」

AI 走 `github_api` 工具，以你**默认账户**的身份调用 GitHub REST API。账户选择可用 `accountId` 指定。

### 工具一览

| 工具 | 作用 |
|---|---|
| `github_accounts` | `list` / `add` / `default` / `refresh` / `remove` 账户。 |
| `github_api` | 以连接账户调用任意 GitHub REST API：`method`、`path`、`query`、`body`。 |

## 安全 / Security

- 面板与 Host 之间只走**同源** HTTP；Host 校验 `Host` 必须是 loopback、`Origin` 必须与之一致、`Sec-Fetch-Site` 不能是 `cross-site`。
- 所有写操作还要求 `x-dsh-github-manager: 1` 标记头，挡住简单表单式 CSRF。
- 令牌存在本地文件，接口响应里只出现末四位预览。
- 权限由你授予的 token scope 决定；插件本身不额外提权。

## 设备码登录（可选）

设备流需要 GitHub OAuth App 的 `Client ID`（GitHub 的设备流不接受匿名客户端）。在面板「设备码」区填入 Client ID → 开始设备登录 → 在 GitHub 页面输入显示的设备码即可。

## License

MIT
