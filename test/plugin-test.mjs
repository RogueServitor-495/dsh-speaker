// plugin-test.mjs —— dsh-tts 插件本地测试（macOS 环境）。
// 直接加载插件 index.js，用 mock ctx 注册工具，再调用 execute 做真实朗读测试。
// 运行：node test/plugin-test.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "..");

const plugin = await import(path.join(pluginRoot, "index.js"));
const registered = [];
plugin.apply({
  tools: {
    register: (def) => {
      registered.push(def);
      return () => {};
    }
  }
});

const speak = registered.find((d) => d.name === "speak");
const voices = registered.find((d) => d.name === "tts_voices");

const freshSignal = () => new AbortController().signal;
let failures = 0;
function check(label, cond, extra = "") {
  console.log((cond ? "PASS" : "FAIL") + "  " + label + (extra ? "  → " + extra : ""));
  if (!cond) failures++;
}

check("注册了 speak 工具", !!speak);
check("注册了 tts_voices 工具", !!voices);

// ---- tts_voices ----
const v = await voices.execute({}, { signal: freshSignal() });
check("tts_voices 返回语音列表", v.count > 0 && Array.isArray(v.voices), "count=" + v.count);
const tingting = v.voices.find((x) => x.name.toLowerCase().includes("tingting"));
check("列表含中文语音 Tingting", !!tingting, tingting ? JSON.stringify(tingting) : "");
check("所有 id 为地区标识", v.voices.every((x) => /^[a-z]{2,3}_[A-Z]{2}$/.test(x.id)));

// ---- speak 基本播放（中文自动选中文语音，低音量） ----
const r1 = await speak.execute({ text: "你好，macOS 语音播报测试。", volume: 30 }, { signal: freshSignal() });
check("speak 中文播放成功", r1.ok === true, JSON.stringify(r1));

// ---- 按地区关键字指定语音 ----
const r2 = await speak.execute({ text: "Hello from macOS.", voice: "zh-CN", volume: 20 }, { signal: freshSignal() });
check("speak voice=zh-CN 解析成功", r2.ok === true, JSON.stringify(r2));

// ---- 按精确语音名指定 ----
const r3 = await speak.execute({ text: "Tingting voice test.", voice: "Tingting", volume: 20 }, { signal: freshSignal() });
check("speak voice=Tingting 成功", r3.ok === true, JSON.stringify(r3));

// ---- 语速 ----
const r4 = await speak.execute({ text: "Rate test.", rate: 8, volume: 20 }, { signal: freshSignal() });
check("speak rate=8 成功", r4.ok === true, JSON.stringify(r4));

// ---- 未知语音 → 报错 ----
let err1 = null;
try {
  await speak.execute({ text: "x", voice: "NoSuchVoiceXYZ", volume: 10 }, { signal: freshSignal() });
} catch (e) {
  err1 = e;
}
check("未知语音报错 Voice not found", !!err1 && /Voice not found/.test(String(err1 && err1.message)), err1 && err1.message);

// ---- 空文本 → 报错 ----
let err2 = null;
try {
  await speak.execute({ text: "   " }, { signal: freshSignal() });
} catch (e) {
  err2 = e;
}
check("空文本报错", !!err2, err2 && err2.message);

// ---- 中途取消 ----
const ctrl = new AbortController();
const abortPromise = speak.execute(
  { text: "这是一段较长的文字，用于测试取消功能。" + "重复测试。".repeat(200), volume: 20 },
  { signal: ctrl.signal }
);
setTimeout(() => ctrl.abort(), 350);
let err3 = null;
try {
  await abortPromise;
} catch (e) {
  err3 = e;
}
check("中途取消报错", !!err3 && /取消/.test(String(err3 && err3.message)), err3 && err3.message);

// ---- render 输出 ----
const view = speak.output.render(
  { text: "hi" },
  { ok: true, text: "hi", voice: "Tingting", rate: 0, volume: 50, message: "已通过扬声器播放完毕。" }
);
check("render 输出文本", Array.isArray(view) && view[0].text.includes("已通过扬声器播放完毕"), JSON.stringify(view && view[0]));

console.log(failures === 0 ? "\n✅ 全部测试通过" : "\n❌ " + failures + " 项失败");
process.exit(failures === 0 ? 0 : 1);
