window.__ModuleLoader__.load({
	id: "dsh-tts",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		var react = require("react");

		/* ---- Web 设置页分区：语音播报 ----
		 * 注册进 settings.section 插槽。
		 * 数据读写走 connection.api.settings（describe / mutate），
		 * 服务端 dsh-tts 注册的 namespace "dsh-tts" 提供 schema 与当前值；
		 * 变更后通过 remote 的 settings/document-updated 事件自动刷新。
		 */
		var NS = "dsh-tts";

		function useTtsSettings(api, remote) {
			var valueState = react.useState(null);
			var value = valueState[0];
			var setValue = valueState[1];
			var revState = react.useState(0);
			var rev = revState[0];
			var setRev = revState[1];

			function load() {
				if (!api || typeof api.settings !== "object" || api.settings === null) return;
				api.settings.describe({}).then(function (resp) {
					var result = resp && resp.result;
					if (!result || result.ok !== true) return;
					var ns = (result.value && result.value.namespaces || []).find(function (n) {
						return n && n.ns === NS;
					});
					if (ns) {
						setValue(ns.value || {});
						setRev(ns.revision || 0);
					}
				}).catch(function () {});
			}

			react.useEffect(function () {
				load();
				if (remote && typeof remote.$on === "function") {
					var off = remote.$on("settings/document-updated", function () { load(); });
					return function () { try { off(); } catch (e) {} };
				}
			}, [api, remote]);

			function save(patch) {
				if (!api) return;
				var ops = Object.keys(patch).map(function (k) {
					return { op: "set", path: [k], value: patch[k] };
				});
				return api.settings.mutate({
					ns: NS,
					ops: ops,
					expectedRevision: rev
				}).then(function () { load(); }).catch(function () { load(); });
			}

			return { value: value || {}, rev: rev, load: load, save: save };
		}

		function TtsSettingsSection(props) {
			var api = props.api;
			var remote = props.remote;
			var tts = useTtsSettings(api, remote);
			var value = tts.value;
			var voices = Array.isArray(value.voices) ? value.voices : [];
			var voice = typeof value.voice === "string" ? value.voice : "";
			var rate = typeof value.rate === "number" ? value.rate : 0;
			var volume = typeof value.volume === "number" ? value.volume : 100;

			function select(key, v) {
				var next = {};
				next[key] = v;
				tts.save(next);
			}

			var rowStyle = { display: "flex", alignItems: "center", gap: 10, margin: "8px 0", minWidth: 0 };
			var labelStyle = { width: 90, flex: "none", color: "var(--dsw-alias-label-secondary, #8b96ad)", fontSize: 13 };
			var controlStyle = { flex: 1, minWidth: 0 };
			var selectStyle = { width: "100%", background: "var(--dsw-alias-bg-module-platform, #111b2e)", color: "var(--dsw-alias-label-primary, #dbe4f0)", border: "1px solid #2c3d5f", borderRadius: 8, padding: "6px 8px", fontSize: 13 };
			var rangeStyle = { width: "100%" };
			var hintStyle = { color: "var(--dsw-alias-label-tertiary, #66748a)", fontSize: 12, margin: "4px 0 0" };

			return react.createElement("div", { style: { padding: "4px 0" } },
				react.createElement("div", { style: rowStyle },
					react.createElement("span", { style: labelStyle }, "音色"),
					react.createElement("div", { style: controlStyle },
						react.createElement("select", {
							style: selectStyle,
							value: voice,
							onChange: function (e) { select("voice", e.target.value); }
						},
							react.createElement("option", { value: "" }, "自动（含中文用中文语音，否则系统默认）"),
							voices.map(function (v) {
								return react.createElement("option", { key: v, value: v }, v);
							})
						),
						react.createElement("div", { style: hintStyle }, "列表来自本机已安装语音（tts_voices），也可在 speak 调用时按名称/地区指定")
					)
				),
				react.createElement("div", { style: rowStyle },
					react.createElement("span", { style: labelStyle }, "语速 " + rate),
					react.createElement("div", { style: controlStyle },
						react.createElement("input", { type: "range", min: -10, max: 10, step: 1, value: rate, style: rangeStyle, onChange: function (e) { select("rate", Number(e.target.value)); } }),
						react.createElement("div", { style: hintStyle }, "-10（最慢）~ 10（最快），0 为正常")
					)
				),
				react.createElement("div", { style: rowStyle },
					react.createElement("span", { style: labelStyle }, "音量 " + volume),
					react.createElement("div", { style: controlStyle },
						react.createElement("input", { type: "range", min: 0, max: 100, step: 1, value: volume, style: rangeStyle, onChange: function (e) { select("volume", Number(e.target.value)); } }),
						react.createElement("div", { style: hintStyle }, "0 ~ 100，默认 100")
					)
				),
				react.createElement("div", { style: hintStyle, marginTop: 6 },
					"作为 speak 工具的默认值：调用时未显式指定音色/语速/音量即使用这里的设置。"
				)
			);
		}

		/* ---- 客户端插件入口 ---- */
		function apply(ctx) {
			ctx.slots.inject("settings.section", function () {
				return ctx.slots.register({
					name: "settings.section",
					id: "dsh-tts",
					order: 60,
					label: "语音播报",
					inject: function () {
						var connection = ctx.get("connection");
						return {
							api: connection && connection.api,
							remote: ctx.get("remote")
						};
					}
				}, TtsSettingsSection);
			});
		}

		exports.apply = apply;
		// 客户端短服务名：settings.section 插槽（slots）+ 数据读写（connection/remote）
		exports.inject = ["slots", "connection", "remote"];
		return module.exports;
	}
});
