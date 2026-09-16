# dsh-deepseek-quota

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web GUI 加一个**「额度」视图**：在会话顶部的「对话 / 轨迹 / 上下文」之后，多出一个标签页，用来看 DeepSeek 账户还剩多少钱、**今天 0 点到现在花了多少**、以及今天和近 7 天用了多少 token —— **按模型分开统计**。

一个 Cordis 插件包，Host + 浏览器两半，零运行期依赖、零构建步骤。

---

## 它长什么样

点开顶部标签栏最右边的**「额度」**，是一个铺满内容区的页面，三张卡片：

**① DeepSeek 账户余额**

```
¥9.01  CNY
● 账户状态正常，可继续调用
充值余额                                  ¥9.01
赠送余额                                  ¥0.00
```

**② 今日使用** —— 当天 00:00 起，按模型分开统计

```
┌──────────────────┐ ┌────────┐ ┌────────┐ ┌───────────┐
│ 今日消费（估算）   │ │ 请求次数 │ │ 涉及会话 │ │ 合计 tokens │
│ ¥3.08            │ │ 199 次  │ │ 5 个    │ │ 32.6M     │
└──────────────────┘ └────────┘ └────────┘ └───────────┘

模型分类
┌──────────────────────────────────────────────────────────────┐
│ deepseek-v4-flash                                    ¥3.08   │
│ deepseek-official · 199 次请求 · 高峰 41 次                    │
│ 输入(未命中) 1.1M   缓存命中 31.2M   输出 263K   合计 32.6M     │
└──────────────────────────────────────────────────────────────┘

输入 tokens（缓存未命中）        1,135,933
输出 tokens                         262,919
缓存命中 tokens                  31,179,008
缓存写入 tokens                           0
推理 tokens（含在输出内）                 —
合计 tokens                      32,577,860
估算消费                            ¥3.0808

消费按官方单价估算（CNY / 百万 tokens，取自 2026-09-15）：未命中输入、
缓存命中输入、输出分别计价；推理已含在输出内，不重复计费。
高峰时段：北京时间周一至周五 09:00–12:00、14:00–18:00 为高峰，其余为空闲时段。
余额实际扣减 ¥1.54（自 18:46 起，仅覆盖插件可观测到的窗口）——与估算的差额来自本机日志之外的调用。
tokens 口径：provider 回报的 usage，仅覆盖本机记录的会话（已扫描 5 个会话）。
```

> 上面这块是真实数据：199 次请求、41 次落在高峰时段、32.6M tokens、估算 ¥3.08。

**③ 近 7 天 tokens**

横向柱状图，今天标为「今天」并高亮，悬停显示精确值、请求次数与当天的估算消费。

另外输入框下方有一枚常驻胶囊「剩余额度 ¥7.72」，点一下只重查余额，不触发日志扫描。

---

## 数据从哪来（以及哪些地方我说不清楚）

| 数字 | 来源 | 精度 |
| --- | --- | --- |
| 账户余额 | `GET https://api.deepseek.com/user/balance` | 权威，官方接口原值 |
| 今日消费 | **官方单价 × 真实 token 用量**，覆盖当天 00:00 → 现在 | 估算（已实测偏差 ≈ 6%） |
| 余额实际扣减 | 当日首次读取的余额 − 当前余额 | 账户真实扣减，但窗口起点取决于插件何时启动 |
| token 用量 | 本机会话日志里 provider 回报的 `usage`，按模型分组 | 权威，但只覆盖本机 |
| 模型归属 | 事件自带的 `data.message.source.model` | 权威，绝不从设置推断 |

### 今日消费：为什么是「官方单价 × token」而不是「余额差」

「今天 0 点到现在花了多少钱」只能靠单价算。余额差做不到——**余额接口只给当前值，没有历史**，所以「余额差」最早只能从插件第一次读到余额的那一刻开始算（今天可能是下午 18:46），上午花的钱就此丢失。

所以这里改成按官方价目表对**每一条请求**计价，当天 00:00 起的用量全都在数，与插件何时启动无关。

价目表来自 DeepSeek 官方中文页（与 CNY 计费账户一致，因此无需任何汇率假设）：

<https://api-docs.deepseek.com/zh-cn/quick_start/pricing> · 读取于 2026-09-15 · CNY / 百万 tokens

| 模型 | 缓存命中 | 缓存未命中 | 输出 |
| --- | --- | --- | --- |
| `deepseek-flash`（含 `deepseek-v4-flash` 等旧名）| 空闲 ¥0.02 / 高峰 ¥0.04 | 空闲 ¥1 / 高峰 ¥2 | 空闲 ¥4 / 高峰 ¥8 |
| `deepseek-v4-pro` | 空闲 ¥0.15 / 高峰 ¥0.30 | 空闲 ¥4.5 / 高峰 ¥9 | 空闲 ¥13.5 / 高峰 ¥27 |

**高峰/空闲按时区正确的逐请求判定**：高峰是北京时间周一至周五 09:00–12:00 与 14:00–18:00，其余为空闲（空闲价是高峰价的一半）。判定把时间戳按固定 UTC+8 平移后再读 UTC 分量，所以无论机器在哪个时区、有没有夏令时都算得对。价格是按**每条请求自己的时间戳**选的，一个跨越两个时段的自然日不会被压成一个混合价。

**计费口径与官方完全对齐**，这一点是查过适配器源码的：DSH 的 `TokenUsage` 是**互斥计数**——`dsh-llm-deepseek` 的 `mapUsage` 会把缓存命中从 `inputTokens` 里减掉，所以：

```
单价费用 = inputTokens × 未命中单价        （inputTokens 已是"未命中"部分）
         + cacheReadTokens × 命中单价
         + outputTokens × 输出单价
```

`reasoningTokens` 是 `outputTokens` 的子集，不重复计费；`cacheWriteTokens` 这个 provider 从不产出，只显示不收费。

**实测校准**：在唯一一个有真实余额基准的窗口里（18:46:36 → 19:05:22，77 次请求），估算 ¥1.6273，账户实际扣减 ¥1.54 —— **偏差约 6%**。差额可能来自余额入账比请求晚一拍。

想跟价目变动，直接改 `lib/index.js` 顶部的 `PRICING` 常量，插件其它部分不依赖里面的数字。

### 「余额实际扣减」为什么还留着

它是唯一**不依赖任何单价**的真实扣钱数字，所以留着当互相印证：

- 当日首次读取余额时把当前值写进 `<DSH_HOME>/dsh-deepseek-quota.json` 作为基准
- 实际扣减 = 基准余额 − 当前余额（钳制 ≥ 0），跨天或充值后自动重新取基准
- 它只覆盖基准建立之后的窗口，界面会写明 `自 18:46 起`

**怎么读这两个数**：估算明显大于实际扣减，通常是估算偏高（价目变了）；估算明显小于实际扣减，通常是本机日志之外的调用——网页版、别的机器、别的客户端。两者接近，说明这台机器就是全部消耗来源。

### token 用量只覆盖本机

用量是从 DSH 本地的会话日志里加总出来的（`ctx.sessionQuery`）。你在网页版、别的机器、或别的前端上消耗的额度**不会**计入「今日使用」，但会体现在「账户余额」里。

统计细节：

- 只累加 `assistant/message` 事件上 provider 回报的 `usage`，不做任何启发式估算
- **模型归属取自事件自己的 `data.message.source`（`{ kind, provider, model }`）**，也就是真正作答的那个模型，不是当前设置里的模型——切过模型的一天会正确分成两行
- 按 `event.time` 落到本地自然日（用日期分量运算构造日界，跨月与夏令时都不会算歪）
- 跳过 fork 会话的 `inheritedEventCount` 前缀，避免继承来的历史被重复计数
- 扫描活动会话 + 7 天内创建的会话，上限 30 个，超出会在界面标注「已截断」
- 单价表里没有的模型照样统计 token，但消费显示「未配置单价」，并单独提示有多少次请求未计价

---

## 安装

需要 DSH 的 web profile。包通过 profile 依赖安装，`cordis.patch.yml` 里的 `insert` 行负责把它插进 composition。

### 从本地路径安装

```sh
dsh plugin --profile web add /path/to/dsh-deepseek-quota
```

Windows 下路径带盘符即可：

```sh
dsh plugin --profile web add "F:\plugins\dsh-deepseek-quota"
```

### 从 GitHub 安装

```sh
dsh plugin --profile web add "github:<你的用户名>/dsh-deepseek-quota"
```

仓库里 **`lib/` 是提交进版本库的**——这个包没有构建步骤，`lib/index.js` 和 `lib/client.js` 就是源码本身，所以 git 安装不需要 `prepare` 脚本，也不会被 pnpm 的构建许可拦住。

### 生效

`dsh plugin add` 会自动做两件事：写 profile 依赖，并把本包追加进 `dsh.profile.bundles`（它认的是 `dsh.bundle.patch` 声明，不需要手工改 `package.json`）。

装完**重启 DSH**（重新加载 web profile）——新的 client bundle 要在启动时进入 boot graph。

### 卸载

```sh
dsh plugin --profile web remove @dsh-external/dsh-deepseek-quota
```

`dsh plugin` 会按已安装状态反向对账，把包从 `bundles` 里摘掉。删掉 `<DSH_HOME>/dsh-deepseek-quota.json` 可以顺手清掉消费基准。

---

## 组成方式

这是一个标准的 DSH profile bundle：

```
package.json          dsh.bundle.patch → cordis.patch.yml；dsh.client.platform = web
cordis.patch.yml      insert 一行 id=deepseek-quota
lib/index.js          Host 半边：注册一条 HTTP 路由
lib/client.js         浏览器半边：__ModuleLoader__ 包裹的模块
```

### Host ↔ 浏览器之间只有一条 HTTP 路由

```
GET /api/dsh/deepseek-quota              余额 + 今日消费 + token 用量
GET /api/dsh/deepseek-quota?scope=balance  只要余额和今日消费
```

没有用 Remote service，也没有用动态插件专属的 `harness.handle` / `host.call`——那对 API 只存在于动态 Cordis 插件里，正式插件拿不到。所以走 `ctx.webServer.register()` 注册一条同源路由，浏览器侧 `fetch(..., { credentials: 'same-origin' })`。

路由做了同源校验（`sec-fetch-site: cross-site` 或与 `Host` 矛盾的 `Origin` 一律 403），非 GET 一律 405。API Key 全程留在 Host 进程，浏览器只收到归一化后的标量。

### 「额度」标签为什么能排在最后

DSH 的列表型 slot 排序规则是 **`priority` 优先，`order` 只是同优先级内的次序**：

```js
next.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || (a.order ?? 0) - (b.order ?? 0))
```

内置的 `chat / trajectory / context` 都没设 `priority`，也就是 `0`。本插件注册 `conversation.view` 时显式写 **`priority: 10`**，于是排到它们后面。

> 顺带一提：这事**动态 Cordis 插件做不到**。动态 Client Guard 会把任何非 chain slot 的 `priority` 强制覆盖成 `env.allocatePriority()`（`--nextPriority`，从 -1 开始），所以动态注册的标签页永远排在所有内置标签**之前**，`order` 再大也翻不过去。想要「放最后」就只能做成正式插件——也就是这个包存在的原因。

### 副作用都挂在 fiber 上

两个 slot 注册、样式表插入、路由注册全部通过 `ctx.effect()` 挂载，停止或卸载插件会全部撤回。样式表用 `document.querySelector('style[data-plugin-css=...]')` 做幂等守卫，避免模块重新物化时重复插入。

---

## 仓库结构

```
.
├── package.json
├── cordis.patch.yml
├── lib/
│   ├── index.js          # Host 半边（ESM，源即产物）
│   └── client.js         # 浏览器半边（__ModuleLoader__ 模块，源即产物）
├── test/
│   ├── host.test.mjs     # 用假 ctx / 假 fetch / 合成会话日志驱动真实路由处理器
│   └── client.test.mjs   # 用假 __ModuleLoader__ 装载 bundle 并做真实 React 服务端渲染
├── README.md
└── LICENSE
```

包内没有构建步骤、没有依赖、没有 devDependency。`lib/*.js` 是可以直接阅读的普通 JavaScript。

### 跑测试

```sh
node test/host.test.mjs      # 51 项检查：路由守卫、余额与消费基准、逐请求定价、高峰时段判定、按模型的用量聚合、内存读取与缓存
node test/client.test.mjs    # bundle 结构 + 两个组件的真实服务端渲染
```

两个脚本都只依赖 Node 内建模块。`client.test.mjs` 需要一份已安装的 DSH 来提供 React（默认 `E:/dsh/DSH Desktop/resources/app`，可用 `DSH_APP_DIR` 覆盖）；找不到时会跳过渲染检查，结构检查照常跑。

想连真实接口一起验：

```sh
DSH_QUOTA_TEST_KEY=sk-... node test/host.test.mjs
```

那个环境变量没设时，实网检查会明确打印 `skip`，不会静默通过。


---

## 性能

打开页面花的时间，几乎全部来自「把会话日志读出来算 token 用量」。本机一次真实测量（会话含 338,697 个事件）：

| 步骤 | 优化前 | 优化后 |
| --- | --- | --- |
| 读取 live 会话日志 | 6,072 ms | **15 ms** |
| 其余会话（持久化） | ~860 ms 串行 | ~150–400 ms 并行 |
| 账户余额接口 | ~77 ms | ~77 ms（与扫描并行） |
| **一次冷启动请求** | **7,382 ms** | **≈ 400 ms** |
| 15 秒内重复打开 | 7,382 ms | **≈ 5 ms**（命中缓存） |

做了四件事：

**1. live 会话直接从内存读 —— 这是最大的一笔。**
`sessionQuery.readSession()` 做的是「把完整日志从持久化读出来 + 逐事件重放校验」，每次请求都原样重做一遍。而当前会话的事件本来就在内存里，`ctx.sessions.get(id).ownEvents()` 直接拿得到。实测 **6,072 ms → 15 ms，快 405 倍**。

`ownEvents()` 已经排除了继承前缀，所以 fork 去重的切分逻辑在这里不需要了；持久化会话仍然照旧切分。

**2. 持久化会话并发读。**
各会话日志互不依赖，之前却在 `for` 循环里逐个 `await`。现在固定 8 个 worker 并发，耗时从「各会话之和」变成「最慢的那个」。

**3. 余额查询与日志扫描并行。**
两者完全独立，之前串行等待。现在一次请求的耗时是两者的**较大值**，而不是**和**。

**4. 短 TTL 缓存 + single-flight。**
余额缓存 10 秒、用量缓存 15 秒。同一时刻到达的多个请求（页面和输入框下方的胶囊会同时问余额）共用**同一次**上游调用。**失败不进缓存**，避免一次网络抖动在整个 TTL 内持续报错。

手动点「刷新」会带 `?fresh=1` 跳过两层缓存重新取真实数据；自动加载则复用新鲜结果，所以切标签页、刷新页面都不会重新扫描日志。

响应里带有 `readFromMemory` / `readFromDisk` / `scannedEvents` 三个字段，用来确认走的确实是内存路径——排查性能问题时比猜测可靠。

---

## 兼容性说明

- 宿主侧用 Node 内建全局 `fetch` 与 `AbortSignal.timeout`，需要 Node 18+（DSH 自带 Node 24）。
- 浏览器侧通过模块加载器的 `require("react")` 取 React，由 shell seed 提供，因此没有把 React 打进 bundle。
- 颜色全部走主题变量（`--dsw-alias-*`），浅色／深色自动适配。
- `dsh.client.inject` 声明为空数组：只依赖 shell 自带的 `slots` 服务，不依赖其他 client bundle 的先加载。

## License

MIT，见 [LICENSE](LICENSE)。
