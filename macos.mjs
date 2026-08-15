// macos.mjs —— dsh-plugin-speaker 插件的 macOS 语音后端。
// 基于 macOS 自带的 say / afplay（均为系统组件，离线可用，无需联网 / API Key）：
//   - say -v '?'       枚举已安装语音，输出 "名称<TAB>地区<TAB># 示例"
//   - say -v <语音> -r <词速> -o <音频文件> -f <文本文件>   合成音频
//   - afplay -v <音量> <音频文件>                           播放（播放级音量，不改系统音量）
// 说明：say 本身不支持音量参数，因此先合成到临时文件、再用 afplay 控制音量播放。

import { spawn } from "node:child_process";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 语速映射：SAPI 风格的 -10..10 → macOS 每分钟词数（近似）。0 表示「正常」（不传 -r，用语音默认语速）。 */
function rateToWpm(rate) {
  return Math.round(200 + rate * 8); // -10 → 120，10 → 280
}

/** 运行一个子进程并收集输出；非零退出码或 signal 中止时 reject。 */
function runChild(cmd, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

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
        const msg = stderr.trim() || stdout.trim() || `${cmd} 退出码 ${code}`;
        reject(new Error(msg));
      }
    });
  });
}

/**
 * 从 say -v '?' 输出中解析语音列表。
 * 不同 macOS 版本输出格式不同：旧版为 "名称<TAB>地区<TAB># 示例"，
 * 新版（如 macOS 26）为空格列对齐 "名称      地区    # 示例"。
 * 名称本身可能含单个空格（如 "Bad News"、"Tingting (中文（中国大陆）)"），
 * 且 CJK 名称会打乱列对齐（分隔可能只剩 1 个空格），因此不按列切分，
 * 而是用正则提取地区标识（xx_XX 形式）来区分名称与地区。
 */
function parseVoiceList(stdout) {
  const voices = [];
  const re = /^\s*(.*?)\s+([a-z]{2,3}_[A-Z]{2})\s*(?:#\s*(.*))?$/;
  for (const line of stdout.split(/\r?\n/)) {
    const m = re.exec(line);
    if (m && m[1] && m[2]) {
      voices.push({ name: m[1].trim(), locale: m[2] });
    }
  }
  return voices;
}

/** 枚举 macOS 已安装语音：say -v '?' → [{ name, locale }]（locale 如 zh_CN / en_US）。 */
export async function listVoices() {
  const { stdout } = await runChild("say", ["-v", "?"], undefined);
  return parseVoiceList(stdout);
}

/** 从给定列表中挑选最合适的中文语音（简体 zh_CN 优先，其次经典语音 Tingting）。 */
function pickChineseVoiceFrom(voices) {
  const zh = voices.filter((v) => /^zh_/i.test(v.locale));
  if (zh.length === 0) return null;

  const cn = zh.filter((v) => /^zh_cn$/i.test(v.locale));
  const pool = cn.length > 0 ? cn : zh;

  const classic = pool.find((v) => {
    const n = v.name.toLowerCase();
    return n === "tingting" || n.startsWith("tingting");
  });
  if (classic) return classic.name;

  // 优先名称里不带括号的经典语音（如 Tingting / Meijia），否则取第一个
  const plain = pool.find((v) => !v.name.includes("("));
  return plain ? plain.name : pool[0].name;
}

/** 选择最合适的中文语音名（zh_CN 优先）；无中文语音时返回 null。 */
export async function pickChineseVoice() {
  return pickChineseVoiceFrom(await listVoices());
}

/**
 * 按关键字模糊匹配语音名：
 *   名称精确 → 名称包含 → 地区包含（zh-CN 会归一化为 zh_cn 再匹配）。
 * 特别地，"chinese" / "中文" 直接选中文本机的中文语音。
 * 找不到返回 null。
 */
export async function resolveVoice(keyword) {
  const voices = await listVoices();
  const kw = String(keyword || "").trim().toLowerCase().replace(/-/g, "_");
  if (!kw) return null;
  if (kw === "chinese" || kw === "中文") return pickChineseVoiceFrom(voices);

  const exact = voices.find((v) => v.name.toLowerCase() === kw);
  if (exact) return exact.name;

  const nameHit = voices.find((v) => v.name.toLowerCase().includes(kw));
  if (nameHit) return nameHit.name;

  const localeHit = voices.find((v) => v.locale.toLowerCase().includes(kw));
  return localeHit ? localeHit.name : null;
}

/**
 * 朗读文字并从默认扬声器播放（同步，播放结束后返回）。
 * @param {string} text 要朗读的文字
 * @param {{ voice?: string, rate?: number, volume?: number }} opts
 *        voice 为语音关键字（可选，省略用系统默认）；rate -10..10；volume 0..100。
 * @param {AbortSignal} [signal] 取消信号（中止时会杀掉 say/afplay 子进程）
 * @returns {Promise<{ usedVoice: string, detail: string }>}
 */
export async function speakText(text, { voice = "", rate = 0, volume = 100 } = {}, signal) {
  // 先解析语音关键字；找不到时给出与 Windows 版一致的提示
  let voiceName = "";
  if (voice) {
    voiceName = await resolveVoice(voice);
    if (!voiceName) {
      throw new Error(`Voice not found: ${voice}. 可用 tts_voices 工具查看全部语音。`);
    }
  }

  const dir = await mkdtemp(join(tmpdir(), "dsh-plugin-speaker-"));
  const textFile = join(dir, "speech.txt");
  const audioFile = join(dir, "speech.aiff");
  try {
    await writeFile(textFile, text, "utf8");

    // 1) 合成音频：say 无法控制音量，先 -o 输出到临时文件
    const sayArgs = [];
    if (voiceName) sayArgs.push("-v", voiceName);
    if (rate !== 0) sayArgs.push("-r", String(rateToWpm(rate)));
    sayArgs.push("-o", audioFile, "-f", textFile);
    await runChild("say", sayArgs, signal);

    // 2) 播放：afplay -v 接受 0..1 的浮点音量，仅作用于本次播放，不修改系统音量
    const vol = String(Math.max(0, Math.min(100, volume)) / 100);
    await runChild("afplay", ["-v", vol, audioFile], signal);

    return { usedVoice: voiceName || "系统默认语音", detail: "" };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
