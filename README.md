# QGauss AI

QGauss AI 是面向个人创作与小型站点运营的自托管平台。把多模型对话、绘画、视频、声音与应用搭档放进同一个工作空间，并为运营者提供账户、渠道、会员、订单与维护工具。

## 产品能力

| 工作空间 | 当前能力 |
|---|---|
| 对话 | 多模型选择、附件理解、流式回答、思考折叠、分支、重新生成、后台续跑、停止与重连、联网检索 |
| 绘画 | 文字与图片创作、多图参考、蒙版编辑、作品库、放大、变体、扩图、融合与动画 |
| 扩展 | 内嵌工具、灵感便签、主题同步、发送确认、对话结果回传、配置与恢复 |
| 视频 | 文字成片、参考图、多素材、改写、续写、精修、口型同步、选帧与说话人物定位、播放与下载 |
| 声音 | 独立文字配音、六种音色、录音转写、回答朗读、完整 MP3 保存、原文复用及私有历史 |
| 账户 | 注册登录、邮箱验证码、资料、改密、找回密码与登录足迹 |
| 应用 | 应用广场、详情、收藏、专属开场白与智能体协作 |
| 运营 | 渠道与模型、次数权益、会员套餐、订单、卡密、签到、分销、邮件回执与加密备份 |
| 外观 | 光屿工作室、青柠游乐场、星际液态，支持玻璃、光影、3D 视觉与动效偏好 |

真实模型、邮件和支付能力需要部署者配置并分别验收。功能存在与本地测试通过，不代表已完成真实收款、外部收信或生产负载验证。当前范围与限制见 [产品状态](docs/STATUS.md)。

## 安装

需要 Node.js 24、npm 10 或更高版本。

```bash
npm ci
npm run setup:guided
npm run serve:prod
```

打开 `http://127.0.0.1:9520/setup`，使用安装凭证创建首位管理员。向导不覆盖既有环境文件，不自动写入演示内容。安装凭证保存在本机运行配置中，请由部署负责人妥善保管。

开发演示可手动复制 `apps/api/.env.example`，设置独立的签名与加密密钥，再运行 `npm run setup`。该路径包含演示账户与本地模拟模型；生产部署应使用安装向导。

## 工程结构

| 目录 | 内容 |
|---|---|
| `apps/api` | 账户、创作任务、渠道、运营与存储服务 |
| `apps/web` | 客户端与管理页面 |
| `scripts/preview` | 使用合成数据的本地页面预览 |
| `scripts/setup` | 安装与部署配置检查 |
| `scripts/web` | 构建、静态资源与发布检查 |
| `docs` | 产品范围、部署、安全、测试与接口说明 |

后端采用 NestJS、TypeScript 与 Prisma，前端采用 Vue 3、Rollup 与 Pinia。目前验证的数据库是 SQLite。数据库更换、集群运行和其他存储方式需要独立适配与验收。

## 开发与验证

```bash
npm run dev
npm run verify
npm run verify:compose
```

完整验证需要先准备开发数据库，HTTP 测试使用数据库副本、临时存储与本地服务。已有服务运行时，应通过 `E2E_PORT` 和 `FAKE_PORT` 指定空闲端口。测试不需要真实模型、支付或邮箱凭据。

`npm run brand:check` 完整检查当前源码，`npm run brand:dist` 同时覆盖保留的历史页面资源。检查包括路径、Unicode 变体、无扩展名文件与二进制可读元信息，每次读取当前文件的全部内容。需要文件数、实际读取字节数、耗时和问题路径时，可以运行 `node scripts/brand-check.mjs --dist --json`；发现受限内容时返回失败状态。

问题与功能改动通过 Issue 跟踪，改动分支通过 Pull Request 合入。提交要求见 [贡献规范](CONTRIBUTING.md)。

- [产品状态](docs/STATUS.md)
- [应用图片形象](docs/APP-IMAGES.md)
- [界面语言与设备偏好](docs/LANGUAGE-PREFERENCES.md)
- [部署与备份](docs/DEPLOY.md)
- [安全边界](docs/SECURITY.md)
- [测试说明](docs/TESTING.md)
- [运营与计费](docs/COMMERCE.md)
- [接口清单](docs/API-ROUTES.md)

<!-- project-growth:start -->

## 项目增长

Star 历史每天自动更新。更新日期采用 UTC，Star 日期沿用 GitHub 聚合口径。

<a href="https://github.com/lijiaqi-AI-Product-Manager/QGauss-AI/stargazers">
<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/lijiaqi-AI-Product-Manager/lijiaqi-AI-Product-Manager/main/assets/growth/QGauss-AI/stars-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/lijiaqi-AI-Product-Manager/lijiaqi-AI-Product-Manager/main/assets/growth/QGauss-AI/stars-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/lijiaqi-AI-Product-Manager/lijiaqi-AI-Product-Manager/main/assets/growth/QGauss-AI/stars-dark.svg">
  <img src="https://raw.githubusercontent.com/lijiaqi-AI-Product-Manager/lijiaqi-AI-Product-Manager/main/assets/growth/QGauss-AI/stars-light.svg" width="960" alt="QGauss AI · GitHub Star 历史">
</picture>
</a>

此项目没有发布对应的 npm／PyPI 包，暂不展示包下载统计。

[数据来源与统计口径](https://github.com/lijiaqi-AI-Product-Manager/lijiaqi-AI-Product-Manager/blob/main/docs/growth.md)

<!-- project-growth:end -->
