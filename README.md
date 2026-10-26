# dsh-github-manager

在 [DeepSeek Harness](https://harness.deepseek.com) (dsh) 内登录 GitHub，并给 dsh 一个**按账户区分的 GitHub 访问通道**——管理面板在左侧栏，AI 用同一套账户操作你的仓库、Issue 与 PR。

Sign in to GitHub inside dsh, manage several accounts, and let the AI operate your GitHub through the connected account.

## 它做什么 / What it does

| 能力 | 说明 |
|---|---|
| 左侧栏入口 | 在 dsh 左侧栏注册「GitHub 管理」入口，点开即是管理面板（注册到 `sidebar.panellist` + 键控 `main` 页）。 |
| 多账户 | 每个账户独立保存（登录名、头像、权限范围、令牌），可设默认账户、刷新、移除。 |
| 登录方式 | Personal Access Token 直接粘贴验证；也支持 OAuth 设备码流程（需自备 OAuth App Client ID）。 |
| 给 AI 的通道 | `github_accounts` / `github_api` 两个 agent 工具，AI 用你的账户调 GitHub REST API。 |
| 面板内操作 | 查看账户、添加/切换/刷新/移除、加载最近仓库并跳转。 |

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

1. 打开左侧栏「GitHub 管理」。
2. 在「添加账户」里粘贴 Personal Access Token（GitHub → Settings → Developer settings → Personal access tokens），至少勾 `repo`。
3. 添加后会立刻验证身份与权限范围；可多账户并存、设默认、刷新、移除。

### 让 AI 操作 GitHub

在同一对话里直接说，例如：

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
