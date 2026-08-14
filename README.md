# dsh-tts

文字转语音播报插件（DSH / DeepSeek Harness 插件）。Agent 通过调用插件注册的工具，把一段文字转成语音并从**默认扬声器**播放出来。

- 离线可用：基于 Windows 自带的 SAPI 语音引擎（`SAPI.SpVoice`），无需联网、无需 API Key。
- 中文友好：自动识别中文文字并选择中文语音（如 `Microsoft Huihui Desktop`），也支持手动指定声音。
- 两个工具：`speak`（朗读播放）、`tts_voices`（列出可用语音）。

## 文件结构

| 文件 | 说明 |
|---|---|
| `package.json` | 插件包描述（ESM，入口 `index.js`） |
| `index.js` | 插件主体：注册工具、生成参数、调用 PowerShell 执行朗读 |
| `speech.ps1` | Windows SAPI 朗读脚本（纯 ASCII，由 `index.js` 调用） |
| `README.md` | 本文档 |

## 工作原理

1. Agent 调用 `speak` 工具，传入要朗读的 `text`（及可选的 `voice` / `rate` / `volume`）。
2. 插件把文字写入临时 UTF-8 文件，然后用 `powershell.exe -File speech.ps1` 启动子进程。
3. `speech.ps1` 用 `SAPI.SpVoice` 朗读文字并同步播放（阻塞直到播放结束）。
4. 播放完成后，工具返回实际使用的语音、语速、音量等信息给 Agent。

播放是同步的：工具会等朗读结束才返回，因此适合播报提醒、朗读通知等场景。

## 安装

把本目录复制到 profile 的 hoisted node_modules，并在 `cordis.patch.yml` 里 insert 一行：

```powershell
# 1. 复制插件（以 web profile 为例；演示插件 dsh-demo-hello 也放在这里）
Copy-Item -Recurse D:\ds-dev-home\dsh-tts C:\Users\<你的用户名>\.dsh\profiles\node_modules\dsh-tts
```

```yaml
# 2. 编辑 C:\Users\<你的用户名>\.dsh\profiles\web\cordis.patch.yml，追加：
- insert:
    - id: dsh-tts
      name: 'dsh-tts'
```

```powershell
# 3. 重启 DSH（让新插件被加载）
```

## 使用示例

安装并重启后，Agent 可以直接通过 tool call 调用：

- 播报提醒：`speak(text: "任务已完成，请查收结果。")`
- 指定中文语音：`speak(text: "你好", voice: "Huihui")`
- 调整语速/音量：`speak(text: "注意！", rate: 2, volume: 80)`
- 列出可用语音：`tts_voices()`

### 参数

`speak`：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `text` | string | 是 | 要朗读并播放的文字 |
| `voice` | string | 否 | 声音名称或关键字（Huihui / Zira / Chinese / English / zh-CN …）。省略时自动选择：含中文用中文语音，否则用系统默认语音 |
| `rate` | integer | 否 | 语速 -10（最慢）~ 10（最快），默认 0 |
| `volume` | integer | 否 | 音量 0 ~ 100，默认 100 |

## 前置条件与常见问题

- **Windows**：依赖 Windows 自带的 SAPI 语音引擎（`powershell.exe` 与 `SAPI.SpVoice`，均为系统组件）。
- **音频设备**：需要本机有可用的音频输出设备（扬声器/耳机）。没有输出设备时朗读会报错。
- **中文语音**：若系统未安装中文语音，中文播报可能无声音或回退到英文语音。可用 `tts_voices` 查看已安装语音；缺少中文语音可在「Windows 设置 → 时间和语言 → 语音 → 添加语音」里安装中文。
- **编码**：朗读文字通过 UTF-8 临时文件传递，支持任意 Unicode 文本；`speech.ps1` 本身为纯 ASCII，规避了 PowerShell 5.1 的无 BOM 脚本编码问题。
