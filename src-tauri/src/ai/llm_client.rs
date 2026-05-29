use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

/// LLM 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LLMConfig {
    #[serde(default = "default_endpoint")]
    pub endpoint: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    /// "openai" | "anthropic"
    #[serde(default = "default_protocol")]
    pub protocol: String,
    /// 当前选择的人设名称
    #[serde(default)]
    pub persona: Option<String>,
    /// 宠物名字 (可在设置中自定义)
    #[serde(default = "default_pet_name")]
    pub pet_name: String,
}

fn default_endpoint() -> String { "https://api.openai.com/v1/chat/completions".into() }
fn default_model() -> String { "gpt-3.5-turbo".into() }
fn default_temperature() -> f64 { 0.8 }
fn default_max_tokens() -> u32 { 1024 }
fn default_protocol() -> String { "openai".into() }
fn default_pet_name() -> String { "喵喵".into() }

impl Default for LLMConfig {
    fn default() -> Self {
        Self {
            endpoint: default_endpoint(),
            api_key: String::new(),
            model: default_model(),
            temperature: default_temperature(),
            max_tokens: default_max_tokens(),
            protocol: default_protocol(),
            persona: None,
            pet_name: default_pet_name(),
        }
    }
}

/// 聊天消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// 流式聊天 — 无状态函数，支持 OpenAI + Anthropic 协议
pub async fn chat_stream(
    config: LLMConfig,
    system_prompt: String,
    history: Vec<ChatMessage>,
    message: String,
    app: tauri::AppHandle,
) -> Result<Vec<ChatMessage>, String> {
    if config.api_key.is_empty() {
        return Err("API Key not configured".into());
    }

    let is_anthropic = config.protocol == "anthropic";

    // ── 构建请求体 ──
    let body = if is_anthropic {
        let mut msgs = Vec::new();
        for msg in &history {
            msgs.push(serde_json::json!({ "role": msg.role, "content": msg.content }));
        }
        msgs.push(serde_json::json!({ "role": "user", "content": message }));
        serde_json::json!({
            "model": config.model,
            "messages": msgs,
            "system": system_prompt,
            "stream": true,
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
        })
    } else {
        let mut messages = Vec::new();
        if !system_prompt.is_empty() {
            messages.push(serde_json::json!({ "role": "system", "content": system_prompt }));
        }
        for msg in &history {
            messages.push(serde_json::json!({ "role": msg.role, "content": msg.content }));
        }
        messages.push(serde_json::json!({ "role": "user", "content": message }));
        serde_json::json!({
            "model": config.model,
            "messages": messages,
            "stream": true,
            "temperature": config.temperature,
        })
    };

    // ── 发送请求 ──
    let client = reqwest::Client::new();

    // 构造目标 URL: Anthropic 协议自动拼接 /v1/messages
    let target_url = if is_anthropic && !config.endpoint.ends_with("/v1/messages") {
        let base = config.endpoint.trim_end_matches('/');
        format!("{}/v1/messages", base)
    } else {
        config.endpoint.clone()
    };

    let mut req = client
        .post(&target_url)
        .header("Content-Type", "application/json");

    if is_anthropic {
        // TokenPlan / 代理层通常使用 Bearer 认证
        let is_tokenplan = config.api_key.starts_with("tp-")
            || config.endpoint.contains("token-plan")
            || config.endpoint.contains("xiaomimimo");
        if is_tokenplan {
            req = req
                .header("Authorization", format!("Bearer {}", config.api_key))
                .header("anthropic-version", "2023-06-01");
        } else {
            req = req
                .header("x-api-key", &config.api_key)
                .header("anthropic-version", "2023-06-01");
        }
    } else {
        req = req.header("Authorization", format!("Bearer {}", config.api_key));
    }

    let resp = req.json(&body).send().await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("API Error ({status}): {text}"));
    }

    // ── 流式解析 ──
    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();
    let mut full_response = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer = buffer[pos + 1..].to_string();

            if line.is_empty() { continue; }
            if !line.starts_with("data: ") { continue; }

            let data = line[6..].trim();

            if is_anthropic {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                    let evt_type = parsed["type"].as_str().unwrap_or("");
                    match evt_type {
                        "content_block_delta" => {
                            if let Some(text) = parsed["delta"]["text"].as_str() {
                                full_response.push_str(text);
                                let _ = app.emit("llm-stream-chunk", text.to_string());
                            }
                        }
                        "message_stop" => {
                            let _ = app.emit("llm-stream-done", full_response.clone());
                            let mut new_history = history;
                            new_history.push(ChatMessage { role: "user".into(), content: message });
                            new_history.push(ChatMessage { role: "assistant".into(), content: full_response });
                            return Ok(new_history);
                        }
                        _ => {}
                    }
                }
            } else {
                if data == "[DONE]" {
                    let _ = app.emit("llm-stream-done", full_response.clone());
                    let mut new_history = history;
                    new_history.push(ChatMessage { role: "user".into(), content: message });
                    new_history.push(ChatMessage { role: "assistant".into(), content: full_response });
                    return Ok(new_history);
                }
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(content) = parsed["choices"][0]["delta"]["content"].as_str() {
                        full_response.push_str(content);
                        let _ = app.emit("llm-stream-chunk", content.to_string());
                    }
                }
            }
        }
    }

    if !full_response.is_empty() {
        let mut new_history = history;
        new_history.push(ChatMessage { role: "user".into(), content: message });
        new_history.push(ChatMessage { role: "assistant".into(), content: full_response.clone() });
        let _ = app.emit("llm-stream-done", full_response);
        return Ok(new_history);
    }
    Ok(history)
}