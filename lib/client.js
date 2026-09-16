window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-deepseek-quota",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");

		/**
		 * dsh-deepseek-quota — browser half.
		 *
		 * Contributes two additive seats and reads everything through the host
		 * half's same-origin route:
		 *
		 * - `conversation.view` (id `quota`) — the "额度" tab. Registered with
		 *   `priority: 10` so it sorts AFTER the shipped views, whose unspecified
		 *   priority is 0: a list slot sorts by priority first, then order.
		 * - `conversation.composer.dock` — a compact always-visible chip.
		 *
		 * The host owns the API key, the pricing table and the session-log scan;
		 * the browser only receives already-normalized scalars.
		 */

		const ROUTE = "/api/dsh/deepseek-quota";

		const CSS = `
.dsq-view{height:100%;min-height:0;overflow:auto;padding:20px 24px 32px;box-sizing:border-box}
.dsq-inner{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
.dsq-view-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px}
.dsq-view-title{font-size:18px;font-weight:650;color:var(--dsw-alias-label-primary);line-height:1.3}
.dsq-view-sub{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.dsq-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.dsq-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsq-tag{font-size:11px;font-weight:400;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 8px;white-space:nowrap}
.dsq-amount{display:flex;align-items:baseline;gap:8px}
.dsq-amount-value{font-size:30px;font-weight:650;letter-spacing:-.01em;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.dsq-amount-currency{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsq-rows{display:flex;flex-direction:column;gap:4px}
.dsq-row{display:flex;justify-content:space-between;gap:16px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsq-row b{color:var(--dsw-alias-label-primary);font-weight:550;font-variant-numeric:tabular-nums}
.dsq-badge{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsq-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary);display:inline-block;flex:none}
.dsq-dot-bad{background:var(--dsw-alias-state-error-primary)}
.dsq-btn{appearance:none;font:inherit;font-size:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 10px;cursor:pointer;flex:none}
.dsq-btn:hover{border-color:var(--dsw-alias-border-l2)}
.dsq-btn:disabled{opacity:.55;cursor:default}
.dsq-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsq-error{color:var(--dsw-alias-state-error-primary);font-size:12px}
.dsq-sub{color:var(--dsw-alias-label-secondary);font-size:12px}
.dsq-hint{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.dsq-hints{display:flex;flex-direction:column;gap:2px}
.dsq-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:10px}
.dsq-cell{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 10px;background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:3px}
.dsq-cell-k{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsq-cell-v{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.dsq-cell-lead{border-color:var(--dsw-alias-brand-primary)}
.dsq-cell-lead .dsq-cell-v{color:var(--dsw-alias-brand-primary)}
.dsq-section-title{font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.02em}
.dsq-models{display:flex;flex-direction:column;gap:8px}
.dsq-model{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:9px}
.dsq-model-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.dsq-model-name{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary);word-break:break-all}
.dsq-model-provider{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-top:1px}
.dsq-model-cost{font-size:14px;font-weight:650;color:var(--dsw-alias-brand-primary);font-variant-numeric:tabular-nums;white-space:nowrap}
.dsq-model-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:8px}
.dsq-metric{display:flex;flex-direction:column;gap:2px}
.dsq-metric-k{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.dsq-metric-v{font-size:12px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-weight:550}
.dsq-warn{font-size:11px;color:var(--dsw-alias-state-warn-primary);line-height:1.6}
.dsq-bars{display:flex;flex-direction:column;gap:6px}
.dsq-bar-row{display:grid;grid-template-columns:52px 1fr 70px;align-items:center;gap:10px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.dsq-bar-track{height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;display:block;border:1px solid var(--dsw-alias-border-l1)}
.dsq-bar-fill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);min-width:2px}
.dsq-bar-value{text-align:right;font-variant-numeric:tabular-nums}
.dsq-chip{appearance:none;font:inherit;font-size:11.5px;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:2px 10px;cursor:pointer}
.dsq-chip:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.dsq-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsq-chip b{color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums}
`;

		/** Insert the package stylesheet once, idempotently across re-materialization. */
		function ensureStyles() {
			const tagId = "@dsh-external/dsh-deepseek-quota";
			if (document.querySelector(`style[data-plugin-css="${tagId}"]`) === null) {
				const tag = document.createElement("style");
				tag.dataset.plugin = tagId;
				tag.dataset.pluginCss = tagId;
				tag.textContent = CSS;
				document.head.appendChild(tag);
			}
			return () => {
				const existing = document.querySelector(`style[data-plugin-css="${tagId}"]`);
				if (existing !== null) existing.remove();
			};
		}

		function symbolOf(currency) {
			if (currency === "CNY") return "¥";
			if (currency === "USD") return "$";
			return "";
		}

		function fmtInt(value) {
			const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
			return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
		}

		function fmtCompact(value) {
			const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
			if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
			if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`;
			return String(Math.round(n));
		}

		/** Money keeps enough decimals to stay non-zero for a cheap day. */
		function fmtMoney(value) {
			const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
			if (n === 0) return "0.00";
			if (n >= 1) return n.toFixed(2);
			if (n >= 0.01) return n.toFixed(3);
			return n.toFixed(4);
		}

		function timeLabel(ms) {
			if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "—";
			const d = new Date(ms);
			return `${d.getHours() < 10 ? "0" : ""}${d.getHours()}:${d.getMinutes() < 10 ? "0" : ""}${d.getMinutes()}`;
		}

		async function requestQuota(scope, fresh) {
			const params = new URLSearchParams();
			if (scope === "balance") params.set("scope", "balance");
			// Only a manual refresh bypasses the host's freshness window; opening the
			// tab reuses a recent answer instead of paying for the scan again.
			if (fresh === true) params.set("fresh", "1");
			const query = params.toString();
			const response = await fetch(query === "" ? ROUTE : `${ROUTE}?${query}`, {
				credentials: "same-origin",
				headers: { accept: "application/json" },
			});
			const payload = await response.json().catch(() => null);
			if (payload === null || typeof payload !== "object") throw new Error(`HTTP ${response.status}`);
			return payload;
		}

		function useQuota(scope) {
			const [state, setState] = React.useState({ phase: "loading" });

			const refresh = React.useCallback((force) => {
				setState({ phase: "loading" });
				requestQuota(scope, force === true).then(
					(payload) => {
						if (payload.ok === true) setState({ phase: "ready", data: payload });
						else setState({ phase: "error", message: String(payload.error ?? "未知错误") });
					},
					(error) => setState({ phase: "error", message: String(error?.message ?? error) }),
				);
			}, [scope]);

			React.useEffect(() => {
				refresh(false);
			}, [refresh]);

			return { state, refresh };
		}

		function balanceOf(payload) {
			const balances = payload?.balance?.balances;
			return Array.isArray(balances) && balances.length > 0 ? balances[0] : null;
		}

		function todayOf(payload) {
			const usage = payload?.usage;
			return usage !== null && usage !== undefined && usage.ok === true ? usage.today : null;
		}

		function statCell(key, label, value, lead) {
			return React.createElement(
				"div",
				{ className: `dsq-cell${lead === true ? " dsq-cell-lead" : ""}`, key },
				React.createElement("span", { className: "dsq-cell-k" }, label),
				React.createElement("span", { className: "dsq-cell-v" }, value),
			);
		}

		function metric(label, value) {
			return React.createElement(
				"div",
				{ className: "dsq-metric" },
				React.createElement("span", { className: "dsq-metric-k" }, label),
				React.createElement("span", { className: "dsq-metric-v" }, value),
			);
		}

		function card(head, children) {
			return React.createElement("section", { className: "dsq-card" }, head, children);
		}

		function cardHead(title, tag) {
			return React.createElement(
				"div",
				{ className: "dsq-card-head" },
				React.createElement("span", null, title),
				tag === undefined || tag === null ? null : React.createElement("span", { className: "dsq-tag" }, tag),
			);
		}

		function balanceCard(quota) {
			const head = cardHead("DeepSeek 账户余额", "api.deepseek.com/user/balance");
			const rows = [];

			if (quota.state.phase === "error") {
				rows.push(React.createElement("div", { key: "error", className: "dsq-error" }, quota.state.message));
			} else if (quota.state.phase !== "ready") {
				rows.push(React.createElement("div", { key: "loading", className: "dsq-sub" }, "正在读取账户余额…"));
			} else {
				const primary = balanceOf(quota.state.data);
				if (primary === null) {
					rows.push(React.createElement("div", { key: "empty", className: "dsq-sub" }, "接口未返回余额条目"));
				} else {
					const symbol = symbolOf(primary.currency);
					rows.push(
						React.createElement(
							"div",
							{ key: "amount", className: "dsq-amount" },
							React.createElement("span", { className: "dsq-amount-value" }, `${symbol}${primary.total}`),
							React.createElement("span", { className: "dsq-amount-currency" }, primary.currency),
						),
						React.createElement(
							"div",
							{ key: "state", className: "dsq-badge" },
							React.createElement("span", {
								className: `dsq-dot${quota.state.data.balance.isAvailable === true ? "" : " dsq-dot-bad"}`,
							}),
							quota.state.data.balance.isAvailable === true ? "账户状态正常，可继续调用" : "账户不可用或余额不足",
						),
						React.createElement(
							"div",
							{ key: "rows", className: "dsq-rows" },
							React.createElement(
								"div",
								{ className: "dsq-row" },
								React.createElement("span", null, "充值余额"),
								React.createElement("b", null, `${symbol}${primary.toppedUp}`),
							),
							React.createElement(
								"div",
								{ className: "dsq-row" },
								React.createElement("span", null, "赠送余额"),
								React.createElement("b", null, `${symbol}${primary.granted}`),
							),
						),
					);
				}
			}

			return card(head, rows);
		}

		/** One card per model, ordered by cost — the classification the reader wants. */
		function modelCards(today, pricing) {
			const models = Array.isArray(today.models) ? today.models : [];
			if (models.length === 0) return null;
			const symbol = symbolOf(pricing?.currency ?? "CNY");

			return React.createElement(
				"div",
				{ className: "dsq-models" },
				models.map((entry) =>
					React.createElement(
						"div",
						{ className: "dsq-model", key: `${entry.provider}/${entry.model}` },
						React.createElement(
							"div",
							{ className: "dsq-model-head" },
							React.createElement(
								"div",
								null,
								React.createElement("div", { className: "dsq-model-name" }, entry.model === "" ? "(未知模型)" : entry.model),
								React.createElement(
									"div",
									{ className: "dsq-model-provider" },
									`${entry.provider === "" ? "未知提供方" : entry.provider} · ${fmtInt(entry.requests)} 次请求` +
										(entry.peakRequests > 0 ? ` · 高峰 ${fmtInt(entry.peakRequests)} 次` : ""),
								),
							),
							React.createElement(
								"div",
								{ className: "dsq-model-cost" },
								entry.unpricedRequests > 0 && entry.pricedRequests === 0
									? "未配置单价"
									: `${symbol}${fmtMoney(entry.cost)}`,
							),
						),
						React.createElement(
							"div",
							{ className: "dsq-model-metrics" },
							metric("输入 (未命中)", fmtCompact(entry.inputTokens)),
							metric("缓存命中", fmtCompact(entry.cacheReadTokens)),
							metric("输出", fmtCompact(entry.outputTokens)),
							metric("合计 tokens", fmtCompact(entry.totalTokens)),
						),
					),
				),
			);
		}

		function usageCard(quota) {
			const head = cardHead("今日使用", "本地自然日 00:00 → 现在");
			const body = [];
			const ready = quota.state.phase === "ready";
			const payload = ready ? quota.state.data : null;
			const today = ready ? todayOf(payload) : null;
			const pricing = payload?.usage?.pricing ?? null;

			if (quota.state.phase === "error") {
				body.push(React.createElement("div", { key: "error", className: "dsq-error" }, quota.state.message));
				return card(head, body);
			}

			const hasCost = today !== null && today !== undefined;
			const symbol = symbolOf(pricing?.currency ?? "CNY");
			const cells = [
				statCell("cost", "今日消费（估算）", hasCost ? `${symbol}${fmtMoney(today.cost)}` : "…", true),
				statCell("requests", "请求次数", hasCost ? `${fmtInt(today.requests)} 次` : "…"),
				statCell("sessions", "涉及会话", hasCost ? `${fmtInt(today.sessions)} 个` : "…"),
				statCell("total", "合计 tokens", hasCost ? fmtCompact(today.totalTokens) : "…"),
			];
			body.push(React.createElement("div", { key: "grid", className: "dsq-grid" }, cells));

			if (!ready) {
				body.push(React.createElement("div", { key: "pending", className: "dsq-sub" }, "正在统计今日用量…"));
				return card(head, body);
			}

			const usage = payload.usage;
			if (usage === null || usage === undefined || usage.ok !== true) {
				body.push(
					React.createElement("div", { key: "usage-error", className: "dsq-error" }, String(usage?.error ?? "用量统计失败")),
				);
				return card(head, body);
			}

			if (today.requests === 0) {
				body.push(React.createElement("div", { key: "none", className: "dsq-sub" }, "今天还没有模型请求记录。"));
			} else {
				body.push(React.createElement("div", { key: "models-title", className: "dsq-section-title" }, "模型分类"));
				const models = modelCards(today, pricing);
				if (models !== null) body.push(React.createElement("div", { key: "models" }, models));

				body.push(
					React.createElement(
						"div",
						{ key: "detail", className: "dsq-rows" },
						[
							["输入 tokens（缓存未命中）", fmtInt(today.inputTokens)],
							["输出 tokens", fmtInt(today.outputTokens)],
							["缓存命中 tokens", fmtInt(today.cacheReadTokens)],
							["缓存写入 tokens", fmtInt(today.cacheWriteTokens)],
							["推理 tokens（含在输出内）", fmtInt(today.reasoningTokens)],
							["合计 tokens", fmtInt(today.totalTokens)],
							["估算消费", `${symbol}${fmtMoney(today.cost)}`],
						].map(([label, value], index) =>
							React.createElement(
								"div",
								{ className: "dsq-row", key: String(index) },
								React.createElement("span", null, label),
								React.createElement("b", null, value),
							),
						),
					),
				);
			}

			const hints = [];

			if (today !== null && today.unpricedRequests > 0) {
				hints.push(
					React.createElement(
						"div",
						{ className: "dsq-warn", key: "unpriced" },
						`有 ${fmtInt(today.unpricedRequests)} 次请求的模型不在单价表内，未计入消费估算。`,
					),
				);
			}

			if (pricing !== null) {
				hints.push(
					React.createElement(
						"div",
						{ className: "dsq-hint", key: "pricing" },
						`消费按官方单价估算（${pricing.currency} / 百万 tokens，取自 ${pricing.updated}）：` +
							"未命中输入、缓存命中输入、输出分别计价；推理已含在输出内，不重复计费。",
					),
					React.createElement("div", { className: "dsq-hint", key: "peak" }, `高峰时段：${pricing.peakRule}`),
				);
			}

			const spend = payload.spend;
			hints.push(
				React.createElement(
					"div",
					{ className: "dsq-hint", key: "spend" },
					spend !== null && spend !== undefined && spend.available === true
						? `余额实际扣减 ${symbolOf(spend.currency)}${spend.amount}（自 ${timeLabel(spend.since)} 起，仅覆盖插件可观测到的窗口）——与估算的差额来自本机日志之外的调用。`
						: `余额实际扣减不可用：${String(spend?.reason ?? "未知原因")}`,
				),
			);

			hints.push(
				React.createElement(
					"div",
					{ className: "dsq-hint", key: "coverage" },
					`tokens 口径：provider 回报的 usage，仅覆盖本机记录的会话（已扫描 ${fmtInt(usage.scannedSessions)} 个会话` +
						`${usage.truncated === true ? "，已截断" : ""}）。`,
				),
			);

			body.push(React.createElement("div", { key: "hints", className: "dsq-hints" }, hints));
			return card(head, body);
		}

		function trendCard(quota) {
			const head = cardHead("近 7 天 tokens", "按合计 tokens");
			const usage = quota.state.phase === "ready" ? quota.state.data.usage : null;
			if (usage === null || usage === undefined || usage.ok !== true) {
				return card(head, React.createElement("div", { className: "dsq-sub" }, "—"));
			}

			const symbol = symbolOf(usage.pricing?.currency ?? "CNY");
			const days = Array.isArray(usage.days) ? usage.days : [];
			const todayKey = usage.today?.key ?? null;
			let max = 1;
			for (const day of days) {
				if (typeof day.totalTokens === "number" && day.totalTokens > max) max = day.totalTokens;
			}

			const rows = days.map((day) => {
				const tokens = typeof day.totalTokens === "number" ? day.totalTokens : 0;
				const title = `${fmtInt(tokens)} tokens · ${fmtInt(day.requests)} 次请求 · 估算 ${symbol}${fmtMoney(day.cost)}`;
				return React.createElement(
					"div",
					{ className: "dsq-bar-row", key: day.key },
					React.createElement("span", null, day.key === todayKey ? "今天" : day.label),
					React.createElement(
						"span",
						{ className: "dsq-bar-track" },
						React.createElement("span", { className: "dsq-bar-fill", style: { width: `${Math.round((tokens / max) * 100)}%` } }),
					),
					React.createElement("span", { className: "dsq-bar-value", title }, fmtCompact(tokens)),
				);
			});

			return card(head, React.createElement("div", { className: "dsq-bars" }, rows));
		}

		function QuotaView() {
			const quota = useQuota("all");
			const loading = quota.state.phase === "loading";

			const head = React.createElement(
				"div",
				{ className: "dsq-view-head" },
				React.createElement(
					"div",
					null,
					React.createElement("div", { className: "dsq-view-title" }, "额度"),
					React.createElement("div", { className: "dsq-view-sub" }, "账户剩余余额、今日消费与按模型划分的 token 用量"),
				),
				React.createElement(
					"button",
					{ className: "dsq-btn", type: "button", disabled: loading, onClick: () => quota.refresh(true) },
					loading ? "读取中…" : "刷新",
				),
			);

			return React.createElement(
				"div",
				{ className: "dsq-view" },
				React.createElement("div", { className: "dsq-inner" }, head, balanceCard(quota), usageCard(quota), trendCard(quota)),
			);
		}

		function Chip() {
			const quota = useQuota("balance");
			let label = "读取中…";
			let title = "DeepSeek 剩余额度：读取中（点击刷新）";

			if (quota.state.phase === "error") {
				label = "读取失败";
				title = `DeepSeek 剩余额度读取失败：${quota.state.message}（点击重试）`;
			} else if (quota.state.phase === "ready") {
				const primary = balanceOf(quota.state.data);
				if (primary === null) {
					label = "无数据";
					title = "DeepSeek 余额接口未返回余额条目（点击刷新）";
				} else {
					const symbol = symbolOf(primary.currency);
					label = `${symbol}${primary.total}`;
					const spend = quota.state.data.spend;
					const extra = spend !== null && spend !== undefined && spend.available === true
						? `，余额已扣减 ${symbol}${spend.amount}`
						: "";
					title = `DeepSeek 剩余额度 ${symbol}${primary.total}${extra}（点击"额度"标签查看消费明细）`;
				}
			}

			return React.createElement(
				"button",
				{ className: "dsq-chip", type: "button", title, onClick: () => quota.refresh(true) },
				React.createElement("span", null, "剩余额度"),
				React.createElement("b", null, label),
			);
		}

		const inject = ["slots"];

		/** Register both seats with lifecycle-owned cleanup. */
		function apply(ctx) {
			ctx.effect(() => ensureStyles(), "dsh-deepseek-quota: stylesheet");

			ctx.effect(
				() =>
					ctx.slots.inject("conversation.view", () =>
						ctx.slots.register(
							{
								name: "conversation.view",
								id: "quota",
								// A list slot sorts by priority first, then order. The shipped
								// views leave priority unspecified (0), so 10 places this tab last.
								priority: 10,
								order: 30,
								label: () => "额度",
							},
							QuotaView,
						),
					),
				"dsh-deepseek-quota: quota view",
			);

			ctx.effect(
				() =>
					ctx.slots.inject("conversation.composer.dock", () =>
						ctx.slots.register(
							{
								name: "conversation.composer.dock",
								id: "dsh-deepseek-quota",
								order: 30,
								label: () => "DeepSeek 剩余额度",
							},
							Chip,
						),
					),
				"dsh-deepseek-quota: composer chip",
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = "deepseek-quota";
		return module.exports;
	}
});
