use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use notify::Watcher;

// ── 数据类型 ──

/// Coding 工具状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    NotInstalled,
    NotRunning,
    Idle,
    Working,
    TaskCompleted,
}

impl Default for ToolStatus {
    fn default() -> Self { ToolStatus::NotInstalled }
}

/// 被监控的 Coding 工具
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodingTool {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub status: ToolStatus,
    #[serde(skip)]
    pub prev_status: ToolStatus,
    pub current_task: Option<String>,
    pub last_completed_at: Option<String>,
}

/// 监控快照
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorSnapshot {
    pub tools: Vec<CodingTool>,
    pub any_working: bool,
    pub any_just_completed: Vec<String>,
}

/// 工作活跃度追踪 — 每个 watched 工具维护一个"最后活跃时间"
#[derive(Debug)]
struct ActivityTracker {
    last_active: Instant,
    /// 超过此间隔无活动 → 视为空闲
    idle_timeout: Duration,
}

impl ActivityTracker {
    fn new(idle_timeout: Duration) -> Self {
        Self { last_active: Instant::now(), idle_timeout }
    }
    fn ping(&mut self) { self.last_active = Instant::now(); }
    fn is_active(&self) -> bool { self.last_active.elapsed() < self.idle_timeout }
}

// ── CodingToolMonitor ──

pub struct CodingToolMonitor {
    pub tools: Vec<CodingTool>,
    /// 各工具的活跃度追踪
    activity: HashMap<String, ActivityTracker>,
    /// file watcher 句柄（Drop 时自动停止）
    #[allow(dead_code)]
    watcher: Option<notify::RecommendedWatcher>,
    /// watcher 是否已启动
    watcher_started: bool,
    /// 安装状态缓存 — 安装与否变化极慢, 10 分钟刷新一次即可, 避免每轮 poll 都跑 where 命令
    installed_cache: Option<(Instant, HashMap<String, bool>)>,
    /// poll 节流 — 后台线程与前端轮询共享同一次检测结果, 避免重复启动外部进程
    last_poll_at: Option<Instant>,
    last_snapshot: Option<MonitorSnapshot>,
    /// 各工具本轮工作会话的开始时间 (用于过滤过短的"伪任务")
    working_since: HashMap<String, Instant>,
    /// 完成判定冷却 — 活跃度刚消失时记录时间, 冷却期内活跃恢复则视为同一任务继续,
    /// 避免工具执行中写文件有间隙导致"完成→又开始"反复提示
    cooling_since: HashMap<String, Instant>,
}

/// 活跃度消失后需持续静默多久才确认任务完成
const COMPLETION_CONFIRM_SECS: u64 = 20;
/// 工作会话最短时长 — 低于此值的零星文件写入不算一次任务, 结束时不发完成通知
const MIN_WORK_SESSION_SECS: u64 = 20;

impl CodingToolMonitor {
    pub fn new() -> Self {
        let tools = vec![
            CodingTool {
                id: "cursor".into(), name: "Cursor".into(), icon: "🟢".into(),
                status: ToolStatus::NotInstalled, prev_status: ToolStatus::NotInstalled,
                current_task: None, last_completed_at: None,
            },
            CodingTool {
                id: "claude_code".into(), name: "Claude Code".into(), icon: "🟠".into(),
                status: ToolStatus::NotInstalled, prev_status: ToolStatus::NotInstalled,
                current_task: None, last_completed_at: None,
            },
            CodingTool {
                id: "codex".into(), name: "Codex".into(), icon: "🔵".into(),
                status: ToolStatus::NotInstalled, prev_status: ToolStatus::NotInstalled,
                current_task: None, last_completed_at: None,
            },
            CodingTool {
                id: "gemini".into(), name: "Gemini CLI".into(), icon: "🔷".into(),
                status: ToolStatus::NotInstalled, prev_status: ToolStatus::NotInstalled,
                current_task: None, last_completed_at: None,
            },
        ];

        let mut activity = HashMap::new();
        // 15 秒无文件活动 → 视为空闲
        let idle_timeout = Duration::from_secs(15);
        for tool in &tools {
            activity.insert(tool.id.clone(), ActivityTracker::new(idle_timeout));
        }

        Self {
            tools,
            activity,
            watcher: None,
            watcher_started: false,
            installed_cache: None,
            last_poll_at: None,
            last_snapshot: None,
            working_since: HashMap::new(),
            cooling_since: HashMap::new(),
        }
    }

    /// 启动 file watcher（需在 Tokio runtime 外调用，因为 notify 是同步的）
    pub fn start_watcher(&mut self, event_tx: Arc<Mutex<Option<std::sync::mpsc::Sender<WatcherEvent>>>>) {
        if self.watcher_started { return; }

        let mut watcher: notify::RecommendedWatcher = match notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            if let Ok(ev) = res {
                if let Some(tool_id) = infer_tool_from_path(&ev.paths) {
                    let _ = event_tx.lock().ok().and_then(|guard| {
                        guard.as_ref().and_then(|tx| tx.send(WatcherEvent { tool_id: tool_id.to_string() }).ok())
                    });
                }
            }
        }) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[CodingToolMonitor] watcher 创建失败: {}", e);
                return;
            }
        };

        // 监听各工具的活动目录
        let watch_dirs = self.collect_watch_dirs();
        for dir in &watch_dirs {
            if dir.exists() {
                let _ = watcher.watch(dir, notify::RecursiveMode::Recursive);
            }
        }

        self.watcher = Some(watcher);
        self.watcher_started = true;
        eprintln!("[CodingToolMonitor] file watcher 已启动，监听 {} 个目录", watch_dirs.len());
    }

    /// 收集所有需要 watch 的目录
    fn collect_watch_dirs(&self) -> Vec<PathBuf> {
        let mut dirs = Vec::new();

        // Cursor: 只 watch agent 会话目录 — globalStorage 在 IDE 仅开着时也会持续写入,
        // watch 它会把"开着 IDE"误判成"正在执行任务"
        if let Ok(cwd) = std::env::current_dir() {
            dirs.push(cwd.join(".cursor").join("agent"));
        }

        // Claude Code: ~/.claude/
        if let Ok(home) = std::env::var("USERPROFILE") {
            dirs.push(PathBuf::from(&home).join(".claude"));
            dirs.push(PathBuf::from(&home).join(".codex"));
            dirs.push(PathBuf::from(&home).join(".gemini"));
        }

        dirs
    }

    /// 处理 file watcher 事件：ping 对应工具的活跃度
    pub fn on_watcher_event(&mut self, event: &WatcherEvent) {
        if let Some(tracker) = self.activity.get_mut(&event.tool_id) {
            tracker.ping();
        }
    }

    /// 安装状态检测（带 10 分钟缓存）
    fn installed_map(&mut self) -> HashMap<String, bool> {
        if let Some((at, map)) = &self.installed_cache {
            if at.elapsed() < Duration::from_secs(600) {
                return map.clone();
            }
        }
        let mut map = HashMap::new();
        map.insert("cursor".to_string(), is_cursor_installed());
        map.insert("claude_code".to_string(), is_claude_installed());
        map.insert("codex".to_string(), is_codex_installed());
        map.insert("gemini".to_string(), is_gemini_installed());
        self.installed_cache = Some((Instant::now(), map.clone()));
        map
    }

    /// 执行一轮状态检测（进程检测 + 活跃度衰减 + 目录探测）
    /// 整轮只启动 1 次 tasklist + 最多 1 次命令行查询, 并对多调用方做 3 秒节流
    pub fn poll(&mut self) -> MonitorSnapshot {
        if let (Some(at), Some(snap)) = (self.last_poll_at, &self.last_snapshot) {
            if at.elapsed() < Duration::from_secs(2) {
                let mut cached = snap.clone();
                // 完成事件是边沿信号, 只允许首次 poll 的调用方消费;
                // 缓存命中时清空, 否则后台线程和前端轮询会把同一次完成重复播报
                cached.any_just_completed.clear();
                return cached;
            }
        }

        let now = chrono_now();
        let installed_map = self.installed_map();
        let mut procs = ProcessSnapshot::capture();

        for tool in &mut self.tools {
            tool.prev_status = tool.status;

            let installed = installed_map.get(tool.id.as_str()).copied().unwrap_or(false);
            let running = match tool.id.as_str() {
                "cursor"      => procs.has("cursor.exe"),
                "claude_code" => procs.has("claude.exe") || procs.node_cmdline_contains("claude"),
                "codex"       => procs.has("codex.exe") || procs.node_cmdline_contains("codex"),
                "gemini"      => procs.has("gemini.exe") || procs.node_cmdline_contains("gemini"),
                _             => false,
            };

            // 推断"是否正在工作"
            let activity_active = self.activity
                .get(&tool.id)
                .map(|t| t.is_active())
                .unwrap_or(false);

            // Cursor 后台 agent 会话目录最近有写入 → 视为工作中
            // 注意: 不能拿 extension host 进程存在性当工作信号 — IDE 开着它就一直存在, 会恒报"工作中"
            let cursor_agent_working = tool.id == "cursor" && cursor_agent_recently_active();

            let raw_working = activity_active || cursor_agent_working;

            // 完成判定滞回: 活跃度刚消失时不立即判完成, 先进入冷却观察期;
            // 期间活跃恢复则视为同一任务继续, 消除"完成→又开始"的反复提示
            let working = if raw_working {
                self.cooling_since.remove(&tool.id);
                self.working_since.entry(tool.id.clone()).or_insert_with(Instant::now);
                true
            } else if self.working_since.contains_key(&tool.id) {
                let cooling_start = *self.cooling_since
                    .entry(tool.id.clone())
                    .or_insert_with(Instant::now);
                cooling_start.elapsed() < Duration::from_secs(COMPLETION_CONFIRM_SECS)
            } else {
                false
            };

            let new_status = if !installed {
                ToolStatus::NotInstalled
            } else if !running {
                ToolStatus::NotRunning
            } else if working {
                ToolStatus::Working
            } else if tool.prev_status == ToolStatus::Working {
                // 工作时长足够才算一次真正的任务完成, 零星文件写入静默回到空闲
                let long_enough = self.working_since
                    .get(&tool.id)
                    .map(|t| t.elapsed() >= Duration::from_secs(MIN_WORK_SESSION_SECS))
                    .unwrap_or(false);
                if long_enough { ToolStatus::TaskCompleted } else { ToolStatus::Idle }
            } else {
                ToolStatus::Idle
            };

            // 会话结束后清理追踪, 为下一次任务做准备
            if !working {
                self.working_since.remove(&tool.id);
                self.cooling_since.remove(&tool.id);
            }

            tool.status = new_status;

            match new_status {
                ToolStatus::Working => { tool.current_task = Some("正在执行任务...".into()); }
                ToolStatus::TaskCompleted => { tool.current_task = None; tool.last_completed_at = Some(now.clone()); }
                _ => { tool.current_task = None; }
            }
        }

        let any_working = self.tools.iter().any(|t| t.status == ToolStatus::Working);
        let any_just_completed: Vec<String> = self.tools.iter()
            .filter(|t| t.status == ToolStatus::TaskCompleted)
            .map(|t| t.name.clone())
            .collect();

        for tool in &mut self.tools {
            if tool.status == ToolStatus::TaskCompleted { tool.status = ToolStatus::Idle; }
        }

        let snapshot = MonitorSnapshot { tools: self.tools.clone(), any_working, any_just_completed };
        self.last_poll_at = Some(Instant::now());
        self.last_snapshot = Some(snapshot.clone());
        snapshot
    }
}

// ── Watcher 事件 ──

#[derive(Debug)]
pub struct WatcherEvent {
    pub tool_id: String,
}

/// 从 watcher 事件路径推断所属工具
fn infer_tool_from_path(paths: &[PathBuf]) -> Option<&str> {
    let path_str = paths.first()?.to_string_lossy().to_lowercase();

    // 只认工具自己的隐藏目录 — 宽匹配会被无关路径误触发 (如 Cursor IDE 的普通配置写入)
    if path_str.contains(".cursor") { return Some("cursor"); }
    if path_str.contains(".claude") { return Some("claude_code"); }
    if path_str.contains(".codex") { return Some("codex"); }
    if path_str.contains(".gemini") { return Some("gemini"); }

    None
}

// ── 进程快照 ──

/// 一轮 poll 共享的进程快照: 单次 tasklist 拿到全部进程名,
/// 命令行查询(用于识别 node 跑的 CLI 工具)按需懒执行且整轮最多一次
struct ProcessSnapshot {
    /// 全部进程名 (小写)
    names: std::collections::HashSet<String>,
    /// node.exe 的命令行合并文本 (小写), None = 尚未查询
    node_cmdlines: Option<String>,
}

impl ProcessSnapshot {
    fn capture() -> Self {
        let names = run_hidden("tasklist", &["/FO", "CSV", "/NH"])
            .map(|out| {
                out.lines()
                    .filter_map(|line| {
                        let trimmed = line.trim();
                        let without_quote = trimmed.strip_prefix('"')?;
                        without_quote.split('"').next()
                    })
                    .map(|name| name.to_lowercase())
                    .collect()
            })
            .unwrap_or_default();
        Self { names, node_cmdlines: None }
    }

    fn has(&self, name: &str) -> bool {
        self.names.contains(&name.to_lowercase())
    }

    /// node.exe 命令行中是否包含关键字 (claude / codex / gemini)
    /// 过滤：带 --stdio 参数的进程是 MCP server，不算用户主动运行的 CLI 工具
    fn node_cmdline_contains(&mut self, keyword: &str) -> bool {
        if !self.has("node.exe") {
            return false;
        }
        if self.node_cmdlines.is_none() {
            // wmic 在新版 Windows 11 可能不存在, 失败时回退 PowerShell CIM 查询
            let text = run_hidden("wmic", &["process", "where", "name='node.exe'", "get", "commandline", "/format:list"])
                .filter(|out| !out.trim().is_empty())
                .or_else(|| run_hidden("powershell", &[
                    "-NoProfile", "-NonInteractive", "-Command",
                    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { $_.CommandLine }",
                ]))
                .unwrap_or_default();
            self.node_cmdlines = Some(text.to_lowercase());
        }
        self.node_cmdlines.as_deref().map(|cmdlines| {
            cmdlines.lines().any(|line| {
                if !line.contains(keyword) { return false; }
                // MCP server 进程用 --stdio 与宿主通信，排除以避免误判
                if line.contains("--stdio") { return false; }
                true
            })
        }).unwrap_or(false)
    }
}

/// Cursor agent 会话目录最近是否有写入 (.cursor/agent/)
fn cursor_agent_recently_active() -> bool {
    if let Ok(cwd) = std::env::current_dir() {
        let agent_dir = cwd.join(".cursor").join("agent");
        if agent_dir.is_dir() && has_recent_file(&agent_dir, 8) {
            return true;
        }
    }
    false
}

// ── 各工具安装/运行检测 ──

fn is_cursor_installed() -> bool {
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        if PathBuf::from(&local).join("Programs").join("cursor").exists() { return true; }
    }
    which_exists("cursor")
}

fn is_claude_installed() -> bool {
    if which_exists("claude") { return true; }
    if let Ok(appdata) = std::env::var("APPDATA") {
        if PathBuf::from(&appdata).join("npm").join("claude.cmd").exists() { return true; }
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        if PathBuf::from(&home).join(".claude").is_dir() { return true; }
    }
    false
}

fn is_codex_installed() -> bool {
    if which_exists("codex") { return true; }
    if let Ok(appdata) = std::env::var("APPDATA") {
        if PathBuf::from(&appdata).join("npm").join("codex.cmd").exists() { return true; }
    }
    // 不以 .codex 目录是否存在作为安装判据：MCP 插件也会创建该目录，会造成误判
    false
}

fn is_gemini_installed() -> bool {
    if which_exists("gemini") { return true; }
    if let Ok(appdata) = std::env::var("APPDATA") {
        if PathBuf::from(&appdata).join("npm").join("gemini.cmd").exists() { return true; }
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        if PathBuf::from(&home).join(".gemini").is_dir() { return true; }
    }
    false
}

// ── 通用工具函数 ──

/// 以隐藏窗口方式执行外部命令并返回 stdout
/// CREATE_NO_WINDOW: GUI 程序下直接 spawn 控制台进程会闪黑窗, 必须屏蔽
fn run_hidden(program: &str, args: &[&str]) -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new(program)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn which_exists(cmd: &str) -> bool {
    run_hidden("where", &[cmd]).map(|out| !out.trim().is_empty()).unwrap_or(false)
}

fn has_recent_file(dir: &std::path::Path, within_secs: u64) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else { return false; };
    let now = std::time::SystemTime::now();
    for entry in entries.flatten() {
        if let Ok(metadata) = entry.metadata() {
            if let Ok(modified) = metadata.modified() {
                if let Ok(duration) = now.duration_since(modified) {
                    if duration.as_secs() <= within_secs { return true; }
                }
            }
        }
        if entry.path().is_dir() {
            if let Ok(sub) = std::fs::read_dir(entry.path()) {
                for sub_entry in sub.flatten() {
                    if let Ok(metadata) = sub_entry.metadata() {
                        if let Ok(modified) = metadata.modified() {
                            if let Ok(duration) = now.duration_since(modified) {
                                if duration.as_secs() <= within_secs { return true; }
                            }
                        }
                    }
                }
            }
        }
    }
    false
}

fn chrono_now() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    format!("{:02}:{:02}:{:02}", ((secs / 3600) + 8) % 24, (secs % 3600) / 60, secs % 60)
}