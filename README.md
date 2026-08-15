# dsh-tts

文字转语音播报插件（DSH / DeepSeek Harness 插件）。Agent 通过调用插件注册的工具，把一段文字转成语音并从**默认扬声器**播放出来。

跨平台、离线可用，无需联网、无需 API Key：

| 平台 | 实现 | 语音引擎 |
|---|---|---|
| Windows | `speech.ps1`（由 `powershell.exe` 调用） | 系统自带 SAPI（`SAPI.SpVoice`） |
| macOS | `macos.mjs`（调用系统 `say` + `afplay`） | 系统自带语音（Tingting、Meijia、Eddy 家族等） |

- 中文友好：自动识别中文文字并选择中文语音，也支持手动指定声音。
- 两个工具：`speak`（朗读播放）、`tts_voices`（列出可用语音）。

## 文件结构

| 文件 | 说明 |
|---|---|
| `package.json` | 插件包描述（ESM，入口 `index.js`） |
| `index.js` | 插件主体：注册工具、生成参数、按平台分派到 Windows / macOS 后端 |
| `speech.ps1` | Windows SAPI 朗读脚本（纯 ASCII，仅 Windows 使用） |
| `macos.mjs` | macOS 后端：枚举语音、语音匹配、`say` 合成 + `afplay` 播放 |
| `test/plugin-test.mjs` | 本地测试脚本（macOS 上可直接运行） |
| `README.md` | 本文档 |

## 工作原理

1. Agent 调用 `speak` 工具，传入要朗读的 `text`（及可选的 `voice` / `rate` / `volume`）。
2. 插件把文字写入临时 UTF-8 文件，然后按平台调用朗读引擎：
   - **Windows**：`powershell.exe -File speech.ps1`，用 `SAPI.SpVoice` 朗读并同步播放。
   - **macOS**：先用 `say -v <语音> -r <词速> -o <临时音频> -f <文本>` 合成音频文件，再用 `afplay -v <音量> <音频>` 播放。
3. 播放完成后，工具返回实际使用的语音、语速、音量等信息给 Agent。

播放是同步的：工具会等朗读结束才返回，因此适合播报提醒、朗读通知等场景。

> macOS 说明：`say` 本身不支持音量参数，所以采用「先合成、后播放」两步：音量由 `afplay -v` 控制，**只影响本次播放，不修改系统音量**。语速参数（-10 ~ 10）会近似映射为 `say` 的每分钟词数（120 ~ 280，0 表示使用语音默认语速）。

## 安装

把本目录复制到 profile 的 hoisted node_modules，并在 `cordis.patch.yml` 里 insert 一行：

```powershell
# 1. 复制插件（以 web profile 为例；Windows 下示例路径为 D:\ds-dev-home\dsh-tts）
Copy-Item -Recurse <插件路径>\dsh-tts <profile目录>\profiles\node_modules\dsh-tts
```

```yaml
# 2. 编辑 <profile目录>\profiles\<profile名>\cordis.patch.yml，追加：
- insert:
    - id: dsh-tts
      name: 'dsh-tts'
```

```powershell
# 3. 重启 DSH（让新插件被加载）
```

> macOS 上的 profile 目录通常为 `~/.dsh/profiles`。

## 使用示例

安装并重启后，Agent 可以直接通过 tool call 调用：

- 播报提醒：`speak(text: "任务已完成，请查收结果。")`
- 指定中文语音：`speak(text: "你好", voice: "Tingting")`（macOS）／`voice: "Huihui"`（Windows）
- 按地区指定：`speak(text: "hello", voice: "zh-CN")`（macOS）
- 调整语速/音量：`speak(text: "注意！", rate: 2, volume: 80)`
- 列出可用语音：`tts_voices()`

### 参数

`speak`：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `text` | string | 是 | 要朗读并播放的文字 |
| `voice` | string | 否 | 声音名称或关键字。省略时自动选择：含中文用中文语音，否则用系统默认语音 |
| `rate` | integer | 否 | 语速 -10（最慢）~ 10（最快），默认 0 |
| `volume` | integer | 否 | 音量 0 ~ 100，默认 100 |

### 各平台语音差异

- **Windows**：语音描述为「微软中文名」，如 `Microsoft Huihui Desktop`；`voice` 支持按描述或 ID 模糊匹配（如 `Huihui`、`Zira`、`Chinese`、`zh-CN`）。
- **macOS**：语音名为英文，如 `Tingting`（普通话）、`Meijia`（台湾）、`Sinji`（香港）以及 `Eddy` 多语言家族（新系统上名称可能带本地化后缀，如 `Tingting (中文（中国大陆）)`）。`voice` 支持按名称或地区模糊匹配（`Tingting`、`Eddy`、`zh-CN`、`en-US`、`Chinese`）。

## 测试（macOS）

本地测试脚本会直接加载插件、用 mock ctx 注册工具并真实朗读（低音量）：

```bash
cd dsh-tts
mkdir -p node_modules/@deepseek-ai
ln -s <DSH缓存>/node_modules/@deepseek-ai/dsh-tools node_modules/@deepseek-ai/dsh-tools
node test/plugin-test.mjs
```

覆盖：工具注册、语音枚举（`tts_voices`）、中文自动选语音、按名称/地区指定语音、语速、音量、未知语音报错、空文本报错、中途取消。

## Web 设置页（默认音色 / 语速 / 音量）

插件带一个 **Web 设置页分区**（设置 → 语音播报）：
音色下拉（列表来自本机已安装语音）、语速滑杆（-10 ~ 10）、音量滑杆（0 ~ 100）。
改动持久化到 `settings.yaml` 的 `dsh-tts` 小节，作为 `speak` 工具在调用参数未显式指定时的默认值。

> ⚠️ **已知前提（DSH 0.1.0-rc.6）**：Web 客户端能读写的 settings namespace 由核心包
> `dsh-host-apiproxy` 的 `WEB_SETTINGS_NAMESPACES` 白名单控制（官方源码注明"让插件自行暴露是
> deferred work"）。要启用本分区，需要在该数组加一行 `"dsh-tts"`：
> ```js
> // node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js
> const WEB_SETTINGS_NAMESPACES = [
>   "dsh-tts",          // ← 新增
>   "agent-loop",
>   ...
> ];
> ```
> 建议先备份原文件再改；dsh 升级或清空 npx 缓存后需重新添加。改完重启 dsh 生效。

## 前置条件与常见问题

- **Windows**：依赖系统自带的 SAPI 语音引擎（`powershell.exe` 与 `SAPI.SpVoice`）。
- **macOS**：依赖系统自带的 `say` 与 `afplay`（均为 macOS 内置组件，无需安装）。
- **音频设备**：需要本机有可用的音频输出设备（扬声器/耳机）。没有输出设备时朗读会报错。
- **中文语音**：若系统未安装中文语音，中文播报可能无声音或回退到英文语音。可用 `tts_voices` 查看已安装语音；macOS 可在「系统设置 → 辅助功能 → 朗读内容 → 系统声音」里添加/下载更多语音。
- **找不到语音**：`Voice not found: xxx` 说明关键字未匹配到任何语音，用 `tts_voices` 查看实际名称。
- **编码**：朗读文字通过 UTF-8 临时文件传递，支持任意 Unicode 文本；`speech.ps1` 本身为纯 ASCII，规避了 PowerShell 5.1 的无 BOM 脚本编码问题。