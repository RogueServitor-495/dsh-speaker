// dsh-tts：文字转语音播报插件。
// 注册两个工具：
//   - speak       把文字朗读出来并从默认扬声器播放
//   - tts_voices  列出系统已安装的 SAPI 语音
// 通过 Windows 自带的 SAPI 语音引擎（离线、无需联网、无需 API Key）实现。
//
// 插件结构（与 demo-hello 一致）：
//   name   —— 插件名（用于日志 / 配置键）
//   inject —— 声明需要 "tools" 服务来注册工具
//   apply  —— 生命周期入口，ctx 是运行时注入的服务容器

import { defineTool } from "@deepseek-ai/dsh-tools";
import { spawn } from "node:child_process";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "dsh-tts";
export const inject = ["tools"];

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEECH_PS1 = join(__dirname, "speech.ps1");

// 判断文字是否含中日韩字符，用于未指定语音时自动选中文语音
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/**
 * 以子进程方式运行 powershell.exe 执行 speech.ps1。
 * 返回 Promise<{ stdout, stderr }>；非零退出码时以错误信息 reject。
 * signal 中止时会杀掉子进程并 reject。
 */
function runPowershell(args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        SPEECH_PS1,
        ...args
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    const onAbort = () => {
      child.kill();
      reject(new Error("语音播报已被取消。"));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const cleanup = () => {
      if (signal) signal.removeEventListener("abort", onAbort);
    };

    child.on("error", (err) => {
      cleanup();
      reject(err);
    });
    child.on("close", (code) => {
      cleanup();
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const msg =
          stderr.trim() || stdout.trim() || `powershell 退出码 ${code}`;
        reject(new Error(msg));
      }
    });
  });
}

/**
 * 把文字写入临时 UTF-8 文件，调用 speech.ps1 朗读。
 * 返回实际使用的语音描述（从 stdout 的 "OK|<desc>" 解析）。
 */
async function speakText(text, voice, rate, volume, signal) {
  const dir = await mkdtemp(join(tmpdir(), "dsh-tts-"));
  const textFile = join(dir, "speech.txt");
  try {
    await writeFile(textFile, text, "utf8");
    const args = ["-TextFile", textFile];
    if (voice) args.push("-Voice", voice);
    args.push("-Rate", String(rate ?? 0), "-Volume", String(volume ?? 100));

    const { stdout, stderr } = await runPowershell(args, signal);

    // 解析 "OK|<语音描述>"
    const m = /OK\|(.*)/.exec(stdout);
    const usedVoice = m && m[1] ? m[1].trim() : (voice || "系统默认语音");
    return { usedVoice, detail: (stderr || "").trim() };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function apply(ctx) {
  // ---- 工具 1：speak ----
  const speak = defineTool({
    name: "speak",
    description:
      "把一段文字转成语音并通过扬声器（默认音频输出设备）播放出来。适合播报提醒、朗读文本、语音通知等。播放是同步的：工具会在朗读完成后才返回。",

    parameters: {
      text: {
        type: "string",
        required: true,
        description: "要朗读并播放的文字。"
      },
      voice: {
        type: "string",
        description:
          "声音名称或匹配关键字（例如 Huihui、Zira、Chinese、English、zh-CN）。省略时自动选择：含中文的文字用中文语音，否则用系统默认语音。可用 tts_voices 工具查看全部可用语音。"
      },
      rate: {
        type: "integer",
        description: "语速，-10（最慢）到 10（最快），0 为正常。默认 0。"
      },
      volume: {
        type: "integer",
        description: "音量，0（静音）到 100（最大）。默认 100。"
      }
    },

    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          text: { type: "string", required: true },
          voice: { type: "string", required: true },
          rate: { type: "integer", required: true },
          volume: { type: "integer", required: true },
          message: { type: "string", required: true }
        }
      },
      render: (_args, value) => [
        {
          type: "text",
          text:
            value.message +
            "（语音：" + value.voice + "，语速 " + value.rate +
            "，音量 " + value.volume + "）"
        }
      ]
    },

    async execute(args, exec) {
      const text = typeof args.text === "string" ? args.text.trim() : "";
      if (!text) {
        throw new Error("要朗读的文字不能为空。");
      }

      // 未指定语音且文字含中文时，自动优先中文语音
      let voice = typeof args.voice === "string" ? args.voice.trim() : "";
      if (!voice && CJK_RE.test(text)) {
        voice = "Chinese";
      }

      let rate = typeof args.rate === "number" ? args.rate : 0;
      let volume = typeof args.volume === "number" ? args.volume : 100;
      rate = Math.max(-10, Math.min(10, rate));
      volume = Math.max(0, Math.min(100, volume));

      const { usedVoice } = await speakText(
        text,
        voice,
        rate,
        volume,
        exec.signal
      );

      return {
        ok: true,
        text,
        voice: usedVoice,
        rate,
        volume,
        message: "已通过扬声器播放完毕。"
      };
    },

    presentCall(args) {
      const t = typeof args.text === "string" ? args.text : "";
      return {
        card: "generic",
        title: "朗读文字",
        kind: "execute",
        rawInput: t.length > 200 ? t.slice(0, 200) + "…" : t
      };
    },

    presentResult(_args, result) {
      return {
        card: "generic",
        title: "已播放",
        content: result.content
      };
    }
  });

  // ---- 工具 2：tts_voices ----
  const ttsVoices = defineTool({
    name: "tts_voices",
    description:
      "列出系统当前已安装、可供 speak 工具使用的语音（含名称与标识），帮助选择 voice 参数。",

    parameters: {},

    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          count: { type: "integer", required: true },
          voices: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string", required: true },
                id: { type: "string", required: true }
              }
            }
          }
        }
      },
      render: (_args, value) => {
        const list = value.voices.map((v) => v.name).join("；");
        return [
          {
            type: "text",
            text:
              "共 " + value.count + " 个语音：" +
              (list || "（无）")
          }
        ];
      }
    },

    async execute(_args, exec) {
      const { stdout } = await runPowershell(["-List"], exec.signal);
      const voices = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const idx = line.indexOf("\t");
          if (idx >= 0) {
            return { name: line.slice(0, idx).trim(), id: line.slice(idx + 1).trim() };
          }
          return { name: line, id: "" };
        });
      return { count: voices.length, voices };
    },

    presentCall() {
      return { card: "generic", title: "列出可用语音", kind: "read" };
    }
  });

  ctx.tools.register(speak);
  ctx.tools.register(ttsVoices);
}
