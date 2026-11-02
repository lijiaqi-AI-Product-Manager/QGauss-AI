# 测试脚本说明

## 分层

| 层 | 位置 | 依赖 | 秒级 |
|---|---|---|---|
| 纯函数单测（后端） | `apps/api/test/*.spec.mjs` | 无 | <1s |
| Service 单测（后端） | `apps/api/test/services.spec.mjs` | 无（用假 Prisma） | <1s |
| 启动与安全边界 | `apps/api/test/security.spec.mjs` | 本机临时 HTTP 服务、生产启动子进程 | 数秒 |
| 纯函数单测（前端） | `apps/web/test/*.spec.mjs` | 无 | <1s |
| 全链路 e2e | `apps/api/test/e2e.mjs` | API + fake-upstream | ~40s |
| 前后端契约 | `apps/web/test/admin-contract.mjs` | API | ~5s |
| 生成任务单测 | `apps/api/test/chat-run.spec.mjs` | 可控观察连接，无数据库 | <1s |
| 生成任务 HTTP | `apps/api/test/chat-runs.e2e.mjs` | API + 可控真实上游连接 | ~10s |
| 压测 | `apps/api/test/load.mjs` | API | ~15s |

### Service 单测怎么写的

不连数据库，直接构造 service 并传入**手写的假 Prisma**：

```js
const prisma = { sensitiveWord: { findMany: async () => [{ word: 'x', action: 'block' }] } };
const svc = new ModerationService(prisma);
```

好处：不用起库、毫秒级、能精确控制边界（例如让 `aggregate` 返回刚好到阈值的数字）。
代价：假对象是手写的，**Prisma 查询写错它不会报错**——所以这类测试不能替代 e2e，
两者是互补关系：单测锁逻辑分支，e2e 锁真实数据通路。

目前覆盖：限流桶（配置变更/过期）、敏感词（匹配优先级/缓存/失效）、
配额（阈值/summary）、渠道路由（排序/过滤/异常/解密失败降级）。

单测直接 `node test/xxx.spec.mjs` 运行（`node --test` 会为每个文件起子进程，
在受限环境里会被拦，所以这里用直接执行的方式）。

## 跑 e2e 前要准备

```bash
# 一条命令：自动拉起 fake-upstream 与 API、跑完自动清理
# （先 npm run build；9520/9899 被占会直接报错，避免打到旧服务）
npm run e2e:auto -w @qgauss/api

# 或者手工三终端：
npm run fake -w @qgauss/api    # 终端 1
npm run start -w @qgauss/api   # 终端 2
npm run e2e -w @qgauss/api     # 终端 3
```

`.env` 需要：

```
ALLOW_HTTP_UPSTREAM=1
UPSTREAM_PORT_ALLOWLIST="443,80,11434,9899"
UPSTREAM_PRIVATE_ALLOWLIST="127.0.0.1:9899"
```

e2e 自己会在开头把 `security.chatRateLimit` 与 `security.registerRateLimit` 置 0、重置熔断，
保证每次运行起点一致；限流单独在最后一节验证。

## fake-upstream 剧本

`apps/api/test/fake-upstream.mjs`，用 `x-scenario` 请求头或模型名选择：

| 剧本 | 用途 |
|---|---|
| `normal` | 正常流式（回复里带 `SYS:<system 前 30 字>`，用于验证应用注入） |
| `slow-first-token` | 首 token 慢 3 秒 |
| `mid-stream-error` | 发 3 个 chunk 后报错 |
| `http-429/500/401/404` | 直接返回状态码 |
| `malformed-json` | 非法 JSON 分片 |
| `split-utf8` | 中文按字节切开跨 chunk |
| `no-done` | 没有 `[DONE]` |
| `hang` | 永不响应（配合渠道超时验证 FAILED） |
| `length` / `reasoning` | 结束原因 / 推理内容 |
| `crlf` | CRLF 分隔 + 同一事件多行 data（验证解析兼容性） |
| `run-hold` / `qgauss-run-hold` 模型名 | 持续输出直到连接关闭；`GET /stats` 记录上游调用和活跃连接，用于验证续接不重复调用、明确停止关闭连接 |

## 加用例的约定

- **一个用例一个断言**，名字写"用户视角的行为"，不写实现细节
- 失败时一定要带实际值：`ok('名字', cond, 'actual=' + value)`
- 不要 mock 掉 fetch：要验证上游异常，就在 fake-upstream 加剧本
- 用例之间不要依赖顺序（e2e 里会创建临时资源，尽量用完即删）

## 前端接口契约（web-api-contract.mjs）

页面里的 `api.get/post/patch/del` 路径必须是后端真实存在的路由。脚本扫 `apps/web/src` 下的
`.vue/.js`，只检查商业化前缀（`/balance /signin /crami /order /pay /sales`），
路径里的模板变量统一归一化成 `x` 再比对。改路由名却忘了改前端，会在 `npm test` 里红。

已用变异测试验证过它真的会红：把 `/crami/packages` 改成 `/crami/package` 后脚本退出码为 1。

## e2e:auto 自动跑五套

`npm run e2e:auto`（或根目录 `npm run verify` 的 HTTP 阶段）会依次执行：

1. `e2e.mjs` —— 主题套件（251 项）
2. `commerce.e2e.mjs` —— 商业套件（91 项）
3. `apps/web/test/admin-contract.mjs` —— 后台页面 API 契约（33 项）
4. `chat-runs.e2e.mjs` —— 生成任务、断点、归属、删除、并发、取消、超时与扣费幂等（21 项）
5. `security.e2e.mjs` —— XFF 伪造、登录/注册限流、审计 IP、CORS、安全头及静态缓存（10 项）

五套共 406 项断言，均使用 dev.db 的隔离副本；生成任务和安全套件在 finally 中恢复修改的配置。任一失败，编排脚本以非零码退出，并在最后打印每套的 exit code。
测试 API 强制 `NODE_ENV=test`、`TRUST_PROXY=false`，跨域来源固定为 `https://ui.qgauss.test`，不会继承生产代理信任。

Windows 沙箱若禁止本机 HTTP 连接，会出现 `connect EACCES`；需要在允许 loopback 的终端运行完整验证。不要因此跳过 HTTP 测试或改用开发业务数据库。

## 夹具命名规则（血泪）

**所有夹具名/用户名必须真唯一**，用 `uniqName('前缀')` 或 `uniqUser('前缀')`（文件顶部已定义）。

曾经有 8 处写成 `Date.now() % 1000` / `% 10000` / `% 100000`。看起来「时间是随机的」，
实际只有 1000 / 10000 / 100000 种取值——开发库长期复用后，生日悖论必然生效：

```
✘ 创建预设分组 {"code":1001,"message":"分组名称已存在"}
```

产品行为是对的（重名就该 400），错的是测试对「干净数据库」的隐含假设。

同类地雷还有：固定金额、固定时间戳、固定订单号。写夹具时问一句
「这行如果在同一台机器上跑第 200 次，还会一样吗？」
