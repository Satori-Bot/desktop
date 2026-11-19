export type Language = "en" | "zh";
const zh: Record<string, string> = {
  "Install core": "安装核心",
  "First setup needs internet to download the Core and, if needed, Python.":
    "首次设置需要联网下载核心，并在需要时下载 Python。",
  "Choose or enter an executable path": "选择或输入可执行文件路径",
  "Core installation required": "需要安装核心",
  "Install Core before creating and starting a workspace.":
    "请先安装核心，再创建并启动工作区。",
  "Back to workspace": "返回工作区",
  "For example, 0.5.0": "例如：0.5.0",
  "Enter a published version. The example is not filled in automatically.":
    "请输入已发布的版本号，示例不会自动填入。",
  "Local service is offline. You can copy this configuration, but start the workspace before connecting a client.":
    "本地服务处于离线状态。可以复制配置，但连接客户端前请先启动工作区。",
  "Local service is not ready. You can copy this configuration, but confirm it is running and healthy before connecting a client.":
    "本地服务尚未就绪。可以复制配置，但连接客户端前请确认工作区已启动且服务正常。",
  "Core readiness check timed out": "核心就绪检查超时",
  "Recent runtime output:": "最近的运行输出：",
  "Public access is not verified. You can copy this configuration, but check the connection before using it.":
    "公网连接尚未验证。可以复制配置，但使用前请先检查连接。",
  "Python core was not found in PATH or standard user/Homebrew locations. Open Settings and install the pinned core, or select an existing coding-tools-mcp executable.":
    "未在 PATH 或标准用户目录、Homebrew 目录中找到核心。请在设置中安装指定版本的核心，或选择现有的 coding-tools-mcp 可执行文件。",
  "The selected managed core is missing or not executable. Reinstall it or roll back before starting; no other installation was selected.":
    "所选核心不存在或无法执行。启动前请重新安装或回滚；应用未选择其他安装。",
  "uv was not found in PATH or standard user/Homebrew locations. Install uv from https://docs.astral.sh/uv/getting-started/installation/ before installing a managed core":
    "未找到 uv。安装受管理的核心前，请按照 https://docs.astral.sh/uv/getting-started/installation/ 安装 uv。",
  "Enter an exact published version such as 0.5.0":
    "请输入准确的已发布版本号，例如 0.5.0。",
  "Installation failed; previous core remains selected. See core-install.log.":
    "安装失败，仍保留之前选择的核心。请检查网络连接，并查看 core-install.log。",
  "Installation timed out; previous core remains selected. See core-install.log.":
    "安装超时，仍保留之前选择的核心。请检查网络连接，并查看 core-install.log。",
  "New core failed verification; previous core remains selected":
    "新核心验证失败，仍保留之前选择的核心。",
  "No previous managed core is available": "没有可供回滚的受管理核心。",
  "Core installation is already in progress": "核心正在安装，请等待安装完成。",
  "Core installation is in progress": "核心正在安装，请等待安装完成。",
  "Choose an existing workspace folder": "请选择现有的工作区文件夹。",
  "Workspace must be a folder": "工作区路径必须指向文件夹。",
  "Enter a workspace name of 1 to 120 characters":
    "请输入 1 到 120 个字符的工作区名称。",
  "Workspace folder no longer exists": "工作区文件夹已不存在，请重新选择。",
  "Workspace no longer exists": "工作区已不存在。",
  "Workspace port is not configured; save the workspace to allocate it":
    "尚未配置工作区端口，请保存工作区以分配端口。",
  "Bearer credential is missing; save the workspace to generate one":
    "缺少 Bearer 凭据，请保存工作区以生成凭据。",
  "OAuth credentials are missing; repair the workspace configuration":
    "缺少 OAuth 凭据，请修复工作区配置。",
  "Workspace operation is in progress": "工作区正在进行其他操作，请稍后重试。",
  "Workspace operation is already in progress":
    "工作区正在进行其他操作，请稍后重试。",
  "Stop the workspace before removing it, including after a crash":
    "请先停止工作区再移除；即使发生崩溃也需要先停止。",
  "Executable arguments contain invalid characters":
    "可执行文件参数包含无效字符。",
  "Custom core executable is empty": "自定义核心可执行文件不能为空。",
  "Start local MCP before retrying public access":
    "重试公网访问前，请先启动本地 MCP 服务。",
  "Choose safe or trusted permissions before starting this workspace":
    "启动工作区前，请选择安全模式或信任模式。",
  "Public access requires bearer-token or OAuth authentication. Repair this workspace before starting it.":
    "公网访问需要 Bearer 令牌或 OAuth 身份验证，请修复工作区配置后再启动。",
  "OAuth needs a fixed public address. Choose a named tunnel or bearer authentication for a temporary tunnel.":
    "OAuth 需要固定公网地址。请选择命名隧道，或为临时隧道使用 Bearer 身份验证。",
  "Another workspace already uses this port; choose a different port":
    "其他工作区已占用此端口，请选择其他端口。",
  "Port is already in use or availability could not be confirmed. Stop its owner or choose another port; no unrelated process was terminated.":
    "端口已被占用或无法确认可用。请停止占用端口的程序或选择其他端口；应用未终止无关进程。",
  "Python core exited during startup. Open runtime logs for details.":
    "核心在启动时退出，请查看运行日志了解详情。",
  "Core executable is not configured": "尚未配置核心可执行文件。",
  "Core version probe timed out": "检测核心版本超时，请检查所选可执行文件。",
  "Core version probe failed": "检测核心版本失败，请检查所选可执行文件。",
  "Executable did not identify itself as coding-tools-mcp":
    "所选可执行文件未被识别为 coding-tools-mcp。",
  "No active public endpoint": "当前没有可用的公网端点。",
  "Desktop backend unavailable. Open the installed desktop app to manage workspaces.":
    "桌面后端不可用，请打开已安装的桌面应用来管理工作区。",
  "Not connected": "未连接",
  "Local access only": "仅允许本地访问",
  "Starting the external Python core": "正在启动外部核心",
  "Stopping owned processes and verifying port release":
    "正在停止受管理的进程并确认端口释放",
  "Start the core to check tool-call history support":
    "启动核心以检查是否支持工具调用历史",
  "Core startup did not finish; inspect runtime logs and retry":
    "核心未完成启动，请查看运行日志后重试。",
  "Local MCP did not start; public access is unavailable":
    "本地 MCP 服务未启动，公网访问不可用。",
  "This core build does not expose a tool-call journal. Published 0.5.0 supports launch and connection; history requires an event-capable official core executable.":
    "此核心版本不提供工具调用日志。已发布的 0.5.0 支持启动和连接；历史记录需要支持事件日志的官方核心可执行文件。",
  "Port is still unavailable": "端口仍不可用",
  "Owned processes have stopped, but the port is not available. Retry Stop to check again, or edit this workspace to choose another port. No unrelated process will be stopped.":
    "受管理的进程已停止，但端口仍不可用。可重试停止以再次检查，或编辑工作区选择其他端口。不会停止无关进程。",
  "Background operation": "后台操作",
  "Installing core…": "正在安装核心…",
  "Restoring core…": "正在恢复核心…",
  "Authorizing Cloudflare…": "正在授权 Cloudflare…",
  "Setting up tunnel…": "正在配置隧道…",
  "You can switch workspaces and stop services that are not busy.":
    "可以切换工作区，并停止没有其他操作正在进行的服务。",
  "Core installation completed": "核心安装完成",
  "Core rollback completed": "核心回滚完成",
  "Workspace stopped": "工作区已停止",
  "That workspace is no longer available. Nothing was removed.":
    "该工作区已不存在，未移除任何其他工作区。",
  "Stop this workspace before removing it.": "请先停止工作区，再将其移除。",
  "Log output was truncated or restarted. Showing the latest available segment.":
    "日志已截断或重新开始，正在显示最新可用片段。",
  "After restarting or upgrading the core, reconnect your MCP client. If authorization fails, remove this server's saved authorization in the client and sign in again using the password from Show credentials.":
    "重启或升级核心后，请重新连接 MCP 客户端。如果授权失败，请移除该服务器在客户端中的已保存授权，并使用“显示凭据”中的密码重新登录。",
  "Tool-call history requires a core with event-journal support. You can configure one in Settings.":
    "工具调用历史需要支持事件日志的核心，可以在设置中配置。",
  "Tool history unavailable": "工具调用历史不可用",
  "This core build does not expose tool-call history. Install an event-capable official core and select its executable in Settings. No calls are fabricated.":
    "此核心版本不提供工具调用历史。请安装支持事件日志的官方核心，并在设置中选择其可执行文件。应用不会生成虚假调用数据。",
  "Published core 0.5.0 supports launch and connections, but does not expose per-tool-call history. History requires an event-capable official core.":
    "已发布的核心 0.5.0 支持启动和连接，但不提供逐次工具调用历史。历史记录需要支持事件日志的官方核心。",
  "Existing core executable": "现有核心可执行文件",
  "Select an already installed official core for this workspace. Leave the executable empty to use the managed core. Arguments are passed directly, without a shell.":
    "为当前工作区选择已安装的官方核心。可执行文件留空则使用受管理的核心。参数会直接传递，不经过命令行 shell。",
  "Executable path": "可执行文件路径",
  "Arguments (one per line)": "参数（每行一个）",
  "Save runtime selection": "保存核心选择",
  "Use Show credentials to find the password for your MCP client's browser sign-in.":
    "在“显示凭据”中查看密码，用于 MCP 客户端的浏览器登录。",
  "Connected, unverified": "已连接，未验证",
  Unverified: "未验证",
  "Connecting…": "连接中…",
  Unhealthy: "健康检查失败",
  Automatic: "自动",
  Warning: "警告",
  "Show credentials": "显示凭据",
  "Configuration may contain credentials. Keep it private.":
    "配置可能包含凭据，请妥善保管。",
  "Enter a tunnel name and a valid hostname.": "请输入隧道名称和有效的主机名。",
  "No checks returned": "没有返回检查结果",
  "Real tool calls from your running workspace. Latest 200 calls.":
    "来自工作区的真实工具调用，显示最近 200 条。",
  "Run checks again or inspect the runtime logs.":
    "请重新检查，或查看运行日志。",
  "Showing the most recent log output.": "正在显示最近的日志。",
  "Leave empty to generate a secure credential": "留空以自动生成安全凭据",
  "Tunnel token configured": "隧道令牌已配置",
  "Local service is not running. Start it before retrying the tunnel.":
    "本地服务未运行。重试隧道前请先启动。",
  "Open navigation": "打开导航",
  "Main navigation": "主导航",
  "Toggle password visibility": "显示或隐藏密码",
  Dashboard: "概览",
  Connections: "连接",
  Activity: "工具调用",
  Diagnostics: "诊断",
  Settings: "设置",
  WORKSPACE: "工作区",
  "CONTROL ROOM": "控制中心",
  "Local-first. Ready for your tools.": "本地优先，连接你的工具。",
  "Your code. Your machine.": "你的代码，你的设备。",
  "New workspace": "新建工作区",
  "Add workspace": "添加工作区",
  "Choose workspace": "选择工作区",
  "No workspaces yet": "尚无工作区",
  "Create your first workspace": "创建第一个工作区",
  "Connect your code to your AI tools.": "把代码连接到你的 AI 工具。",
  "Choose a folder, start a local service, and connect your favorite MCP client. Your files stay on your machine.":
    "选择文件夹、启动本地服务，并连接 MCP 客户端。文件保留在你的设备上。",
  "Get started": "开始设置",
  "Desktop backend unavailable": "桌面后端不可用",
  "Browser preview only. No services are running here. Open the desktop app to create and manage real workspaces.":
    "此页面仅为浏览器预览，没有正在运行的服务。请打开桌面应用来创建和管理真实工作区。",
  Retry: "重试",
  Refresh: "刷新",
  "Loading your workspaces…": "正在加载工作区…",
  "Could not load workspaces": "无法加载工作区",
  "Start workspace": "启动工作区",
  "Stop workspace": "停止工作区",
  Restart: "重启",
  "Starting…": "正在启动…",
  "Stopping…": "正在停止…",
  Running: "运行中",
  Stopped: "已停止",
  Error: "错误",
  Ready: "就绪",
  Unavailable: "不可用",
  "Not configured": "未配置",
  Checking: "检查中",
  Unknown: "未知",
  Online: "在线",
  Offline: "离线",
  "Local service": "本地服务",
  "Public access": "公网访问",
  "Local only": "仅本地",
  "On this device": "此设备",
  "External clients": "外部客户端",
  "No public endpoint. Your workspace is only accessible on this device.":
    "未配置公网端点。此工作区仅可在这台设备上访问。",
  "Configure access": "配置访问",
  "Copy endpoint": "复制端点",
  "Copy config": "复制配置",
  Copied: "已复制",
  "Operation feedback": "操作反馈",
  "Dismiss notification": "关闭通知",
  "Copy failed": "复制失败",
  Safe: "安全模式",
  Trusted: "信任模式",
  "Mode: Safe": "权限模式：安全",
  "Mode: Trusted": "权限模式：信任",
  "Core version": "核心版本",
  "CPU usage": "CPU 使用率",
  Memory: "内存",
  Uptime: "运行时间",
  "Process ID": "进程 ID",
  "Recent tool calls": "最近的工具调用",
  "View all": "查看全部",
  "No tool calls yet": "还没有工具调用",
  "Connect an MCP client and run a tool. Real calls will appear here automatically.":
    "连接 MCP 客户端并调用工具，真实调用会自动显示在这里。",
  Tool: "工具",
  Outcome: "结果",
  Duration: "耗时",
  Started: "开始时间",
  "All outcomes": "所有结果",
  "Search tools": "搜索工具",
  "No matching calls": "没有匹配的调用",
  "Try another search or filter.": "请尝试其他搜索或筛选条件。",
  Success: "成功",
  Failed: "失败",
  "In progress": "进行中",
  Interrupted: "已中断",
  "No workspace selected": "未选择工作区",
  "Select or create a workspace to continue.": "选择或创建工作区以继续。",
  "Workspace details": "工作区详情",
  "Open folder": "打开文件夹",
  "Edit workspace": "编辑工作区",
  "Remove workspace": "移除工作区",
  "Stop this workspace before changing its configuration.":
    "请先停止工作区，再修改配置。",
  "Access and authentication": "访问与身份验证",
  "Local and public connections are monitored independently.":
    "本地和公网连接分别监控。",
  "Local service remains available. Fix the tunnel without restarting your tools.":
    "本地服务仍然可用。可以修复隧道，无需重启工具。",
  "Retry tunnel": "重试隧道",
  "Temporary Quick Tunnel": "临时隧道",
  "This URL changes after a restart. Use a named tunnel for a stable address and browser authentication.":
    "重启后地址会改变。固定地址和浏览器认证请使用命名隧道。",
  "Stable Cloudflare tunnel": "稳定的 Cloudflare 隧道",
  "Use your domain with a reusable tunnel and browser-based OAuth.":
    "使用自己的域名、可复用的隧道以及浏览器 OAuth 认证。",
  "Authorize Cloudflare": "授权 Cloudflare",
  "Create tunnel and DNS": "创建隧道与 DNS",
  "Tunnel name": "隧道名称",
  Hostname: "主机名",
  "Cloudflare will open your browser. Sign in and select a domain you own.":
    "Cloudflare 将打开浏览器。登录并选择你拥有的域名。",
  "This creates a Cloudflare tunnel and a DNS record in your account.":
    "此操作将在你的账户中创建 Cloudflare 隧道和 DNS 记录。",
  Cancel: "取消",
  Continue: "继续",
  Back: "上一步",
  "Save changes": "保存更改",
  "Save workspace": "保存工作区",
  "Create workspace": "创建工作区",
  "Choose folder": "选择文件夹",
  "Workspace name": "工作区名称",
  "Folder path": "文件夹路径",
  Browse: "浏览",
  Access: "访问方式",
  "Only this device": "仅此设备",
  "Temporary sharing": "临时共享",
  "Stable public access": "稳定公网访问",
  Authentication: "身份验证",
  "No authentication (local only)": "无需认证（仅本地）",
  "Bearer token": "Bearer 令牌",
  "Browser sign-in (OAuth)": "浏览器登录（OAuth）",
  "Permission mode": "权限模式",
  "Allow tools to modify files": "允许工具修改文件",
  "Safe mode allows file edits with stricter execution checks. Only enable trusted mode for code you trust.":
    "安全模式允许编辑文件，并进行更严格的执行检查。仅对可信代码启用信任模式。",
  "Public HTTPS URL": "公网 HTTPS 地址",
  "OAuth password": "OAuth 密码",
  "Cloudflare tunnel token": "Cloudflare 隧道令牌",
  "Leave empty to keep the saved secret": "留空以保留已保存的密钥",
  Port: "端口",
  "0 selects an available port": "0 表示自动选择可用端口",
  Advanced: "高级",
  "Review workspace": "确认工作区",
  "Create a safe place for your tools.": "为工具建立安全的工作空间。",
  "Choose the code folder your MCP tools can access.":
    "选择 MCP 工具可以访问的代码文件夹。",
  "Start local. Share when you are ready.": "先从本地开始，需要时再共享。",
  "You can add secure public access later in Connections.":
    "稍后可在“连接”中添加安全公网访问。",
  "Your workspace is ready to create.": "工作区已准备好创建。",
  "Create and start": "创建并启动",
  "Workspace created": "工作区已创建",
  "Start your workspace to connect an MCP client.":
    "启动工作区以连接 MCP 客户端。",
  Done: "完成",
  "Name and folder are required.": "请填写名称和文件夹。",
  "Remote access requires authentication.": "公网访问需要身份验证。",
  "OAuth requires a stable HTTPS URL.": "OAuth 需要固定的 HTTPS 地址。",
  "Quick Tunnel supports bearer authentication only.":
    "Quick Tunnel 仅支持 Bearer 认证。",
  "Select a folder first.": "请先选择文件夹。",
  "Remove this workspace?": "移除此工作区？",
  "This removes the saved configuration. Your source files are never deleted. Backups and logs are retained.":
    "这会移除保存的配置。不会删除源代码，备份和日志会保留。",
  Remove: "移除",
  "Run checks": "运行检查",
  "Export diagnostics": "导出诊断",
  "Checks cover runtime, folder access, and local/public connectivity.":
    "检查核心运行环境、文件夹权限及本地和公网连接。",
  "Run diagnostics to see what needs attention.":
    "运行诊断以了解需要处理的问题。",
  "Runtime logs": "运行日志",
  "Tunnel logs": "隧道日志",
  "No logs available": "暂无日志",
  "Refresh logs": "刷新日志",
  "Diagnostics exported": "诊断已导出",
  "Redacted report. Review the file before sharing.":
    "报告已做脱敏处理，分享前请检查文件。",
  Preferences: "偏好设置",
  "Make this workspace feel like yours.": "按你的习惯设置应用。",
  Language: "语言",
  Appearance: "外观",
  Light: "浅色",
  Dark: "深色",
  "Close to tray": "关闭窗口后留在托盘",
  "Keep services running when the window closes. Use Quit to stop all services.":
    "关闭窗口后服务继续运行。“退出”会停止所有服务。",
  "Managed core": "受管理的核心",
  "Install a verified version of the external coding-tools-mcp runtime.":
    "安装指定版本的外部 coding-tools-mcp 运行环境。",
  "Version to install": "要安装的版本",
  "Install version": "安装版本",
  "Roll back": "回滚",
  "Changes apply to the next start. Running services are not restarted.":
    "更改会在下次启动时生效，不会重启正在运行的服务。",
  Installed: "已安装",
  Missing: "未安装",
  "Cloudflare connector": "Cloudflare 连接器",
  "Quit application": "退出应用",
  "Quit and stop services?": "退出并停止服务？",
  "All running workspaces will be stopped.": "所有运行中的工作区都将停止。",
  Quit: "退出",
  "Check your setup": "检查设置",
  "1. Choose your code": "1. 选择代码",
  "2. Start locally": "2. 本地启动",
  "3. Connect a client": "3. 连接客户端",
  "No account needed": "无需账户",
  "Safe mode by default": "默认安全模式",
  "Standard MCP protocol": "标准 MCP 协议",
  "Connect a client": "连接客户端",
  "Use the local endpoint or copy the client configuration. Public access is optional.":
    "使用本地端点或复制客户端配置。公网访问为可选项。",
  "Set up a Core before starting a workspace.": "请先配置核心，再启动工作区。",
  "Install recommended Core": "安装推荐版本",
  "Choose a Core to start this workspace": "选择用于启动工作区的核心",
  "Use existing Core": "使用已有核心",
  "Enter an existing core executable.": "请输入已有核心的可执行文件。",
  "The selected core executable was not found or is not executable":
    "找不到所选核心，或文件不可执行。",
  "Enter an absolute workspace folder path": "请输入工作区目录的绝对路径。",
  "Choose a project folder, not a filesystem root":
    "请选择项目目录，而不是磁盘根目录。",
  "Choose or enter an absolute folder path": "选择或输入绝对目录路径",
  "Enter a whole port number from 1 to 65535, or leave blank for automatic.":
    "请输入 1 到 65535 的整数端口，或留空自动选择。",
  "Leave blank to choose an available port.": "留空时自动选择可用端口。",
  "A workspace already has this name; choose a different name":
    "工作区名称已存在，请换一个名称。",
  "Public discovery check expired; run diagnostics to verify the route.":
    "公网验证已过期，请运行诊断重新检查。",
  "Previous checks are stale. Run checks again.":
    "上次检查已过期，请重新检查。",
  "Last diagnostics check": "上次诊断检查",
  Stale: "已过期",
  "Check public address": "检查公网地址",
  "Last public discovery check": "上次公网探测",
  "Public discovery is reachable": "公网探测可达",
  Saved: "已保存",
  "Operation completed": "操作已完成",
  "Working…": "处理中…",
  "Could not load activity": "无法加载工具调用",
  "Unable to refresh status": "无法刷新状态",
  "Last checked": "最近检查",
  "Not running": "未运行",
  "Configuration copied. Keep it private; it may contain credentials.":
    "配置已复制，请妥善保管，其中可能包含凭据。",
  "Configure your client": "配置客户端",
  "Paste the configuration into an MCP-compatible client. It reflects saved settings only.":
    "将配置粘贴到兼容 MCP 的客户端中。此配置仅反映已保存的设置。",
  "View configuration": "查看配置",
  Close: "关闭",
  "Use an existing tunnel token, or save this workspace and authorize Cloudflare below.":
    "使用现有隧道令牌，或保存工作区后在下方授权 Cloudflare。",
  "Managed by external proxy": "由外部代理管理",
  "FRP / existing HTTPS proxy": "FRP / 现有 HTTPS 代理",
  "Configure and run your external proxy separately. Desktop verifies the public endpoint.":
    "请单独配置并运行外部代理，桌面应用会验证公网端点。",
  "Credentials file": "凭据文件",
  "Status unavailable": "状态不可用",
  "Getting started": "快速开始",
  "Built for your workflow": "为你的工作流程而生",
  "Connect locally first, then choose how you share.":
    "先连接本地，再选择共享方式。",
  "No telemetry data": "暂无遥测数据",
  "Secrets stay in your local desktop configuration. Never paste them into issue reports.":
    "密钥保存在本机桌面配置中，请勿粘贴到问题报告。",
  "Install requires uv and network access.": "安装需要 uv 和网络访问。",
  "Enter an exact version, for example 0.5.0.":
    "请输入准确版本号，例如 0.5.0。",
  "Created successfully. Start failed; your workspace is saved and can be retried.":
    "已创建并保存，但启动失败。你可以重试启动。",
};
export const translator = (language: Language) => (text: string) => {
  if (language !== "zh") return text;
  if (zh[text]) return zh[text];
  // Backend failures can append OS details and log output to a known summary.
  // Translate the application text while retaining diagnostic details verbatim.
  return text
    .split("\n")
    .map((line) => {
      if (zh[line]) return zh[line];
      const separator = line.indexOf(": ");
      const summary = line.slice(0, separator);
      return separator >= 0 && zh[summary]
        ? `${zh[summary]} ${line.slice(separator + 2)}`
        : line;
    })
    .join("\n");
};
export type Translate = ReturnType<typeof translator>;
