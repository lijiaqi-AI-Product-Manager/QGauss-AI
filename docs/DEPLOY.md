# 安装、部署与维护

## 首次安装

使用 Node.js 24、npm 10 或更高版本，安装依赖后执行：

```bash
npm ci
npm run setup:guided
npm run serve:prod
```

向导只在运行配置不存在时创建独立凭据，不覆盖已有配置，也不运行演示 seed。打开 `/setup`，由部署负责人填写安装凭证与管理员信息；完成后手动登录 `/welcome` 配置实际服务。

API 和静态页面由同一进程托管，默认端口为 9520。公开部署应通过 HTTPS 反向代理，并严格限制应用端口的访问来源。健康检查为 `GET /api/health`。

## 运行配置

配置项示例见 `apps/api/.env.example`。生产必须使用独立且足够强的 `JWT_SECRET` 和 `APP_ENCRYPTION_KEY`。代理信任默认关闭，跨域只接受明确来源。运行密钥不写入网页、日志或仓库。

邮件通过 `MAIL_*` 环境项配置，生产要求 TLS 或 STARTTLS；配置后先寄出体验信并确认实际收信，再验收找回密码与验证码。未配置发件时不自动投递历史邮件。

模型、绘画、视频与声音通过管理页面配置渠道、协议、模型及价格。保存配置不会发起付费任务；实际连通和效果验证需要部署负责人明确操作。

声音管理可设置新作品保留天数，0 表示保留至主动清理，最多 3650 天。设置只影响之后接受的任务；旧记录沿用原规则。未提交转写的临时录音最多保留 24 小时。到期内容立即停止读取，后台每分钟继续清理，存储暂时失败会保留待处理记录。费用回执不随作品内容删除，备份文件需按部署方的独立保留规则管理。

商业功能默认关闭。开启收费前，应验收真实支付回调、权益到账、重复通知、对账与提现处理。测试订单和本地模拟收款不能代替真实验收。

## 数据升级

当前提供 41 个 SQLite 迁移。升级前确认生成、上传、结算和维护任务已经结束，停止服务并保全数据库、存储与运行配置；再执行：

```bash
npm run prisma:generate -w @qgauss/api
npm run db:init -w @qgauss/api
npm run build
npm run verify
npm start
```

Windows 需要先停止占用 Prisma 客户端的服务再生成客户端。迁移器按文件名向前执行，不提供自动降级。回退前必须保全升级后产生的任务、订单与账本，并完成对账。

## 加密备份与恢复

维护命令应在服务停止后运行。备份密钥与备份文件分开保管，并复制到其他设备。

```bash
npm run ops:keygen -- --key-file <新密钥文件>
npm run ops:backup -- --database <数据库> --storage <存储目录> --env-file <运行配置> --key-file <密钥文件> --output <新备份文件.qgb>
npm run ops:verify -- --input <备份文件.qgb> --key-file <密钥文件>
npm run ops:restore -- --input <备份文件.qgb> --key-file <密钥文件> --destination <新恢复目录>
```

备份包含一致性数据库快照、存储与运行配置，采用独立密钥加密。恢复只输出到新目录，不覆盖现有站点，也不自动启动。切换时必须调整数据库和存储路径，检查域名、外部服务及未结束任务。当前支持 SQLite 与本地存储。

管理员恢复使用 `ops:inspect` 与 `ops:recover-admin`，仅支持既有管理员，不提升普通账户权限。恢复前自动建立加密备份；密码由私有文件提供，不通过命令行明文传递。

## 容器

在仓库根目录的私有环境文件中准备运行密钥。新站点另设置安装凭证，然后运行：

```bash
docker compose -f docker-compose.deploy.yml config --quiet
docker compose -f docker-compose.deploy.yml up -d --build
```

Compose 配置检查与容器实际启动是不同的验收项。镜像构建、真实启动、负载与离机恢复应在目标环境分别验证。
