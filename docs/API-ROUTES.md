# API 路由清单

> 由 `apps/api/scripts/route-inventory.mjs` 静态生成，不要手改。
> 共 **251** 条路由，分布在 **28** 个控制器。

| 模块 | 路由数 | 控制器 |
|---|---|---|
| `/agents` | 16 | `src/modules/agents/agents.controller.ts` |
| `/apps` | 27 | `src/modules/apps/apps.controller.ts` |
| `/auth` | 12 | `src/modules/auth/auth.controller.ts` |
| `/balance` | 7 | `src/modules/commerce/wallet.controller.ts` |
| `/chat` | 4 | `src/modules/chat/chat.controller.ts` |
| `/chat-logs` | 2 | `src/modules/chatlog/chatlog.controller.ts` |
| `/conversations` | 9 | `src/modules/conversations/conversations.controller.ts` |
| `/crami` | 11 | `src/modules/commerce/crami.controller.ts` |
| `/folders` | 4 | `src/modules/folders/folders.controller.ts` |
| `/health` | 2 | `src/modules/health/health.controller.ts` |
| `/image` | 9 | `src/modules/image/image.controller.ts` |
| `/installation` | 4 | `src/modules/installation/installation.controller.ts` |
| `/mail` | 6 | `src/modules/mail/mail.controller.ts` |
| `/menus` | 5 | `src/modules/menu/menu.controller.ts` |
| `/mj` | 23 | `src/modules/midjourney/mj.controller.ts` |
| `/models` | 21 | `src/modules/models/models.controller.ts` |
| `/moderation` | 5 | `src/modules/moderation/moderation.controller.ts` |
| `/order` | 5 | `src/modules/commerce/order.controller.ts` |
| `/pay` | 4 | `src/modules/commerce/pay.controller.ts` |
| `/presets` | 9 | `src/modules/presets/presets.controller.ts` |
| `/sales` | 9 | `src/modules/commerce/sales.controller.ts` |
| `/settings` | 3 | `src/modules/settings/settings.controller.ts` |
| `/signin` | 2 | `src/modules/commerce/signin.controller.ts` |
| `/statistic` | 6 | `src/modules/statistic/statistic.controller.ts` |
| `/upload` | 5 | `src/modules/storage/upload.controller.ts` |
| `/users` | 8 | `src/modules/users/users.controller.ts` |
| `/video` | 22 | `src/modules/video/video.controller.ts` |
| `/voice` | 11 | `src/modules/voice/voice.controller.ts` |

## /agents

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/agents/admin/connections` | ADMIN |
| POST | `/agents/admin/connections` | ADMIN |
| PATCH | `/agents/admin/connections/:id` | ADMIN |
| DELETE | `/agents/admin/connections/:id` | ADMIN |
| POST | `/agents/admin/connections/:id/probe` | ADMIN |
| GET | `/agents/admin/connections/:id/bots` | ADMIN |
| POST | `/agents/admin/connections/:id/import` | ADMIN |
| GET | `/agents/admin/list` | ADMIN |
| GET | `/agents/admin/receipts` | ADMIN |
| POST | `/agents/admin/bots` | ADMIN |
| PATCH | `/agents/admin/bots/:id` | ADMIN |
| POST | `/agents/admin/bots/:id/sync` | ADMIN |
| DELETE | `/agents/admin/bots/:id` | ADMIN |
| GET | `/agents` | 登录 |
| GET | `/agents/:id` | 登录 |
| POST | `/agents/:id/favorite` | 登录 |

## /apps

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/apps/mine` | 登录 |
| GET | `/apps/mine/by-request/:key` | 登录 |
| GET | `/apps/mine/:id` | 登录 |
| POST | `/apps/mine` | 登录 |
| PUT | `/apps/mine/:id` | 登录 |
| POST | `/apps/mine/:id/submit` | 登录 |
| POST | `/apps/mine/:id/withdraw` | 登录 |
| POST | `/apps/mine/:id/trash` | 登录 |
| POST | `/apps/mine/:id/restore` | 登录 |
| POST | `/apps/mine/:id/reconcile` | 登录 |
| GET | `/apps/shared/:shareId` | 访客可读，携带凭据时校验身份 |
| GET | `/apps/admin/review` | ADMIN |
| GET | `/apps/admin/review/:id` | ADMIN |
| POST | `/apps/admin/review/:id` | ADMIN |
| POST | `/apps/admin/review/:id/reconcile` | ADMIN |
| GET | `/apps/categories` | 访客可读，携带凭据时校验身份 |
| GET | `/apps` | 访客可读，携带凭据时校验身份 |
| GET | `/apps/favorites` | 登录 |
| GET | `/apps/:id` | 访客可读，携带凭据时校验身份 |
| POST | `/apps/:id/favorite` | 登录 |
| GET | `/apps/admin/list` | ADMIN |
| POST | `/apps/admin/categories` | ADMIN |
| PATCH | `/apps/admin/categories/:id` | ADMIN |
| DELETE | `/apps/admin/categories/:id` | ADMIN |
| POST | `/apps/admin/create` | ADMIN |
| PATCH | `/apps/admin/:id` | ADMIN |
| DELETE | `/apps/admin/:id` | ADMIN |

## /auth

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/auth/captcha` | 公开 |
| GET | `/auth/registration-policy` | 公开 |
| POST | `/auth/registration-code` | 公开 |
| POST | `/auth/email-verification/send` | 登录 |
| POST | `/auth/email-verification/confirm` | 登录 |
| POST | `/auth/register` | 公开 |
| POST | `/auth/login` | 公开 |
| POST | `/auth/refresh` | 公开 |
| POST | `/auth/forgot-password` | 公开 |
| POST | `/auth/reset-password` | 公开 |
| POST | `/auth/logout` | 公开 |
| GET | `/auth/me` | 登录 |

## /balance

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/balance/query` | 登录 |
| GET | `/balance/consumeLog` | 登录 |
| GET | `/balance/rechargeLog` | 登录 |
| GET | `/balance/accountLog` | ADMIN |
| GET | `/balance/getVisitorCount` | 登录 |
| POST | `/balance/inheritVisitorData` | 登录 |
| POST | `/balance/upgradeBalance` | ADMIN |

## /chat

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/chat/quota` | 登录 |
| GET | `/chat/runs/:messageId/events` | 登录 |
| POST | `/chat/runs/:messageId/cancel` | 登录 |
| POST | `/chat/completions` | 登录 |

## /chat-logs

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/chat-logs` | ADMIN |
| GET | `/chat-logs/export` | ADMIN |

## /conversations

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/conversations` | 登录 |
| POST | `/conversations` | 登录 |
| POST | `/conversations/bulk-delete` | 登录 |
| GET | `/conversations/:id` | 登录 |
| PATCH | `/conversations/:id` | 登录 |
| DELETE | `/conversations/:id` | 登录 |
| DELETE | `/conversations/:id/messages` | 登录 |
| GET | `/conversations/:id/messages/:messageId` | 登录 |
| DELETE | `/conversations/:id/messages/:messageId` | 登录 |

## /crami

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/crami/packages` | 公开 |
| POST | `/crami/package/create` | ADMIN |
| GET | `/crami/package/list` | ADMIN |
| PATCH | `/crami/package/:id` | ADMIN |
| DELETE | `/crami/package/:id` | ADMIN |
| POST | `/crami/create` | ADMIN |
| GET | `/crami/list` | ADMIN |
| GET | `/crami/stats` | ADMIN |
| DELETE | `/crami/:id` | ADMIN |
| POST | `/crami/exchange` | 登录 |
| GET | `/crami/myLog` | 登录 |

## /folders

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/folders` | 登录 |
| POST | `/folders` | 登录 |
| PATCH | `/folders/:id` | 登录 |
| DELETE | `/folders/:id` | 登录 |

## /health

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/health` | 公开 |
| GET | `/health/ready` | 公开 |

## /image

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/image/options` | 登录 |
| GET | `/image/square` | 登录 |
| POST | `/image/tasks` | 登录 |
| GET | `/image/tasks` | 登录 |
| GET | `/image/tasks/:id` | 登录 |
| GET | `/image/tasks/:id/results/:fileId` | 登录 |
| PATCH | `/image/tasks/:id/publish` | 登录 |
| POST | `/image/tasks/:id/cancel` | 登录 |
| DELETE | `/image/tasks/:id` | 登录 |

## /installation

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/installation/status` | 公开 |
| POST | `/installation` | 公开 |
| GET | `/installation/readiness` | ADMIN |
| POST | `/installation/demo` | ADMIN |

## /mail

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/mail/outbox` | ADMIN |
| GET | `/mail/status` | ADMIN |
| GET | `/mail/templates` | ADMIN |
| POST | `/mail/probes` | ADMIN |
| GET | `/mail/probes/:requestKey` | ADMIN |
| POST | `/mail/probes/:id/confirm` | ADMIN |

## /menus

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/menus` | 登录 |
| GET | `/menus/admin` | ADMIN |
| POST | `/menus` | ADMIN |
| PATCH | `/menus/:id` | ADMIN |
| DELETE | `/menus/:id` | ADMIN |

## /mj

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/mj/admin/config` | ADMIN |
| POST | `/mj/admin/presets` | ADMIN |
| PUT | `/mj/admin/presets/:id` | ADMIN |
| GET | `/mj/admin/receipts` | ADMIN |
| POST | `/mj/admin/tasks/:id/check` | ADMIN |
| GET | `/mj/options` | 登录 |
| POST | `/mj/quote` | 登录 |
| POST | `/mj/tasks` | 登录 |
| GET | `/mj/tasks/by-request/:key` | 登录 |
| GET | `/mj/tasks` | 登录 |
| GET | `/mj/trash` | 登录 |
| GET | `/mj/square` | 登录 |
| GET | `/mj/tasks/:id` | 登录 |
| POST | `/mj/tasks/:id/cancel` | 登录 |
| POST | `/mj/tasks/:id/modal` | 登录 |
| POST | `/mj/tasks/:id/seed` | 登录 |
| PATCH | `/mj/tasks/:id/publish` | 登录 |
| DELETE | `/mj/tasks/:id` | 登录 |
| POST | `/mj/tasks/:id/restore` | 登录 |
| GET | `/mj/tasks/:id/playback` | 登录 |
| GET | `/mj/tasks/:id/media/:index` | 登录 |
| GET | `/mj/tasks/:id/poster/:index` | 登录 |
| GET | `/mj/media/:id/:index` | 公开 |

## /models

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/models/available` | 登录 |
| GET | `/models/plaza` | 登录 |
| GET | `/models/channels/health` | ADMIN |
| POST | `/models/channels/health/reset` | ADMIN |
| GET | `/models/channels` | ADMIN |
| POST | `/models/channels` | ADMIN |
| POST | `/models/channels/:id/test` | ADMIN |
| GET | `/models/channels/:id/keys` | ADMIN |
| POST | `/models/channels/:id/keys` | ADMIN |
| POST | `/models/channels/:id/keys/bulk-delete` | ADMIN |
| POST | `/models/channels/:id/keys/:keyId/test` | ADMIN |
| PATCH | `/models/channels/:id/keys/:keyId` | ADMIN |
| DELETE | `/models/channels/:id/keys/:keyId` | ADMIN |
| PATCH | `/models/channels/:id` | ADMIN |
| DELETE | `/models/channels/:id` | ADMIN |
| GET | `/models` | ADMIN |
| POST | `/models` | ADMIN |
| PATCH | `/models/:id` | ADMIN |
| DELETE | `/models/:id` | ADMIN |
| POST | `/models/:id/channels` | ADMIN |
| DELETE | `/models/:id/channels/:channelId` | ADMIN |

## /moderation

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/moderation/words` | ADMIN |
| POST | `/moderation/words` | ADMIN |
| PATCH | `/moderation/words/:id` | ADMIN |
| DELETE | `/moderation/words/:id` | ADMIN |
| GET | `/moderation/hits` | ADMIN |

## /order

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/order/create` | 登录 |
| GET | `/order/list` | 登录 |
| GET | `/order/manage` | ADMIN |
| GET | `/order/detail/:orderId` | 登录 |
| POST | `/order/close/:orderId` | 登录 |

## /pay

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/pay/notify/:provider` | 公开 |
| POST | `/pay/prepare/:orderId` | 登录 |
| GET | `/pay/status/:orderId` | 登录 |
| POST | `/pay/mock/:orderId` | 登录 |

## /presets

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/presets` | 登录 |
| GET | `/presets/admin` | ADMIN |
| GET | `/presets/groups` | ADMIN |
| POST | `/presets/groups` | ADMIN |
| PATCH | `/presets/groups/:id` | ADMIN |
| DELETE | `/presets/groups/:id` | ADMIN |
| POST | `/presets` | ADMIN |
| PATCH | `/presets/:id` | ADMIN |
| DELETE | `/presets/:id` | ADMIN |

## /sales

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/sales/apply` | 登录 |
| GET | `/sales/info` | 登录 |
| GET | `/sales/records` | 登录 |
| GET | `/sales/withdrawals` | 登录 |
| POST | `/sales/withdraw` | 登录 |
| GET | `/sales/manage` | ADMIN |
| PATCH | `/sales/manage/:userId` | ADMIN |
| GET | `/sales/audit` | ADMIN |
| POST | `/sales/audit/:id` | ADMIN |

## /settings

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/settings/public` | 公开 |
| GET | `/settings` | ADMIN |
| PUT | `/settings` | ADMIN |

## /signin

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/signin/signinLog` | 登录 |
| POST | `/signin/sign` | 登录 |

## /statistic

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/statistic/overview` | ADMIN |
| GET | `/statistic/by-model` | ADMIN |
| GET | `/statistic/by-channel` | ADMIN |
| GET | `/statistic/trend` | ADMIN |
| GET | `/statistic/errors` | ADMIN |
| GET | `/statistic/attempts` | ADMIN |

## /upload

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/upload` | 登录 |
| GET | `/upload` | 登录 |
| GET | `/upload/:id` | 登录 |
| GET | `/upload/:id/raw` | 登录 |
| DELETE | `/upload/:id` | 登录 |

## /users

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/users/profile` | 登录 |
| PATCH | `/users/profile` | 登录 |
| POST | `/users/password` | 登录 |
| GET | `/users/logins` | 登录 |
| GET | `/users` | ADMIN |
| PATCH | `/users/:id/status` | ADMIN |
| GET | `/users/:id/logins` | ADMIN |
| POST | `/users/:id/kick` | ADMIN |

## /video

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/video/materials/:kind` | 登录 |
| POST | `/video/materials/from-task/:id` | 登录 |
| GET | `/video/admin/config` | ADMIN |
| POST | `/video/admin/presets` | ADMIN |
| PUT | `/video/admin/presets/:id` | ADMIN |
| GET | `/video/admin/receipts` | ADMIN |
| POST | `/video/admin/tasks/:id/check` | ADMIN |
| GET | `/video/options` | 登录 |
| POST | `/video/quote` | 登录 |
| POST | `/video/tasks` | 登录 |
| GET | `/video/tasks/by-request/:key` | 登录 |
| GET | `/video/tasks` | 登录 |
| GET | `/video/trash` | 登录 |
| GET | `/video/square` | 登录 |
| GET | `/video/tasks/:id` | 登录 |
| POST | `/video/tasks/:id/cancel` | 登录 |
| PATCH | `/video/tasks/:id/publish` | 登录 |
| DELETE | `/video/tasks/:id` | 登录 |
| POST | `/video/tasks/:id/restore` | 登录 |
| GET | `/video/tasks/:id/playback` | 登录 |
| GET | `/video/media/:id/:kind` | 公开 |
| GET | `/video/input/:id/:kind` | 公开 |

## /voice

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/voice/admin/config` | ADMIN |
| PUT | `/voice/admin/config` | ADMIN |
| GET | `/voice/admin/receipts` | ADMIN |
| GET | `/voice/options` | 登录 |
| POST | `/voice/quote` | 登录 |
| POST | `/voice/recordings` | 登录 |
| POST | `/voice/tasks` | 登录 |
| GET | `/voice/tasks/by-request/:key` | 登录 |
| GET | `/voice/tasks/:id` | 登录 |
| POST | `/voice/tasks/:id/cancel` | 登录 |
| GET | `/voice/tasks/:id/audio/:index` | 登录 |
