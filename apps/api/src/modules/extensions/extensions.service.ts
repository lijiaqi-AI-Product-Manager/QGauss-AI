import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';
import { CONFIG_MAP, coerceConfigValue } from '../../common/config/config.registry';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { chatCharge } from '../commerce/chat-pricing';
import { messageBilling } from '../chat/chat-accounting.service';
import type { ChatCompletionDto } from '../chat/dto/chat.dto';
import { BUILTIN_EXTENSION, BUILTIN_URL, builtinExtension, ExtensionEntry, extensionConflict, extensionHash, extensionId, extensionMissing, extensionUrl } from './extension-policy';
import { ExtensionMutationDto, PrepareExtensionRequestDto, SaveExtensionDto } from './extensions.dto';
type Db = Prisma.TransactionClient;
const date = (value: any) => value == null ? null : value instanceof Date ? value : new Date(typeof value === 'bigint' ? Number(value) : value);
function entry(row: any): ExtensionEntry { return { ...row, sort: Number(row.sort), version: Number(row.version), enabled: !!row.enabled, chatEnabled: !!row.chatEnabled, legacyBridge: !!row.legacyBridge, createdAt: date(row.createdAt)!, updatedAt: date(row.updatedAt)!, deletedAt: date(row.deletedAt) }; }
function requestRow(row: any) { return row ? { ...row, extensionVersion: Number(row.extensionVersion), createdAt: date(row.createdAt)!, updatedAt: date(row.updatedAt)!, expiresAt: date(row.expiresAt)! } : null; }
const view = (row: ExtensionEntry) => ({ id: row.id, title: row.title, description: row.description, entryUrl: row.entryUrl, icon: row.icon, tone: row.tone, sort: row.sort, chatEnabled: row.chatEnabled, legacyBridge: row.legacyBridge, version: row.version, builtin: row.id === BUILTIN_EXTENSION });
const key = (value: string) => { if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))
    throw new BusinessException(ErrorCode.PARAM_INVALID, '请求标识无效。', 400); return value; };
@Injectable()
export class ExtensionsService {
    constructor(private readonly prisma: PrismaService, private readonly rate: RateLimitService) { }
    private limit(user: string, kind: string, max = 30) { if (!this.rate.tryConsume('extensions:' + kind + ':' + user, max))
        throw new BusinessException(ErrorCode.RATE_LIMITED, '操作有些频繁，请稍后再试。', 429); }
    private async user(db: Db, id: string, admin = false) { const user = await db.user.findFirst({ where: { id, status: 'ACTIVE', deletedAt: null }, select: { id: true, role: true } }); if (!user || admin && user.role !== 'ADMIN')
        throw new BusinessException(ErrorCode.FORBIDDEN, '当前账号不能完成这个操作。', 403); return user; }
    private async lock(db: Db, id: string) { await db.$executeRaw `UPDATE "users" SET "id"="id" WHERE "id"=${id}`; }
    private async row(db: Db, id: string) { extensionId(id); const rows = await db.$queryRaw<any[]> `SELECT * FROM "extensions" WHERE "id"=${id}`; return rows[0] ? entry(rows[0]) : id === BUILTIN_EXTENSION ? builtinExtension() : null; }
    private async visible(db: Db, userId: string, id: string) { const [user, row] = await Promise.all([this.user(db, userId), this.row(db, id)]); if (!row || row.deletedAt || !row.enabled || !row.roles.split(',').includes(user.role))
        throw extensionMissing(); return row; }
    private async ensureBuiltin(db: Db) { const row = builtinExtension(); await db.$executeRaw `INSERT OR IGNORE INTO "extensions" ("id","title","description","entryUrl","icon","tone","sort","enabled","roles","chatEnabled","legacyBridge","modelId","version","createdAt","updatedAt") VALUES (${row.id},${row.title},${row.description},${row.entryUrl},${row.icon},${row.tone},0,1,${row.roles},1,0,NULL,1,${row.createdAt},${row.updatedAt})`; }
    private async setting(db: Db, name: string) { const row = await db.globalConfig.findUnique({ where: { key: name } }), def = CONFIG_MAP.get(name)!; if (!row)
        return def.default; try {
        return coerceConfigValue(def, JSON.parse(row.value)) ?? def.default;
    }
    catch {
        return def.default;
    } }
    private async plan(db: Db, userId: string, id: string) {
        const row = await this.visible(db, userId, id);
        if (!row.chatEnabled)
            throw new BusinessException(ErrorCode.FORBIDDEN, '这个扩展暂未开放对话请求。', 403);
        const modelName = String(await this.setting(db, 'chat.defaultModel')), model = await db.aiModel.findFirst({ where: { ...(row.modelId ? { id: row.modelId } : { name: modelName }), status: 'ENABLED', deletedAt: null }, include: { channels: { where: { enabled: true }, include: { channel: { select: { id: true, status: true, deletedAt: true, type: true } } } } } });
        if (!model || !model.capabilities.split(',').map(x => x.trim()).includes('chat'))
            throw new BusinessException(ErrorCode.CHANNEL_UNAVAILABLE, '创作搭档尚未准备好，请联系管理员配置对话模型。', 400);
        const demoMode = await this.setting(db, 'demo.siteEnabled') === true, commerce = await this.setting(db, 'commerce.enabled') === true, channels = model.channels.filter(x => x.channel.status === 'ENABLED' && !x.channel.deletedAt);
        if (!demoMode && !channels.length)
            throw new BusinessException(ErrorCode.CHANNEL_UNAVAILABLE, '当前模型尚未接通，便签仍可继续编辑。', 400);
        const charge = chatCharge(model, commerce, demoMode), revision = extensionHash({ entry: view(row), model: { id: model.id, name: model.name, maxContext: model.maxContext, maxOutput: model.maxOutput, channels: channels.map(x => ({ id: x.channelId, type: x.channel.type })) }, charge, demoMode });
        return { entry: row, model, charge, demoMode, revision };
    }
    async list(userId: string) { const user = await this.user(this.prisma, userId), rows = (await this.prisma.$queryRaw<any[]> `SELECT * FROM "extensions" ORDER BY "sort","id"`).map(entry); if (!rows.some(row => row.id === BUILTIN_EXTENSION))
        rows.push(builtinExtension()); return rows.filter(row => !row.deletedAt && row.enabled && row.roles.split(',').includes(user.role)).sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id)).map(view); }
    async get(userId: string, id: string) { return view(await this.visible(this.prisma, userId, id)); }
    async quote(userId: string, id: string) { this.limit(userId, 'quote'); const plan = await this.prisma.$transaction(tx => this.plan(tx, userId, id)); return { revision: plan.revision, extensionVersion: plan.entry.version, modelId: plan.model.id, modelName: plan.model.displayName || plan.model.name, cost: plan.charge?.amount || 0, pool: plan.charge?.pool || null, demoMode: plan.demoMode }; }
    async admin(userId: string) { await this.user(this.prisma, userId, true); const rows = (await this.prisma.$queryRaw<any[]> `SELECT * FROM "extensions" ORDER BY "sort","id"`).map(entry); if (!rows.some(row => row.id === BUILTIN_EXTENSION))
        rows.unshift(builtinExtension()); const models = await this.prisma.aiModel.findMany({ where: { deletedAt: null, status: 'ENABLED' }, select: { id: true, name: true, displayName: true, capabilities: true }, orderBy: { sort: 'asc' } }); return { items: rows.map(row => ({ ...view(row), enabled: row.enabled, roles: row.roles, modelId: row.modelId, archived: !!row.deletedAt, lastRequestKey: row.lastRequestKey })), models: models.filter(row => row.capabilities.split(',').map(x => x.trim()).includes('chat')).map(row => ({ id: row.id, name: row.displayName || row.name })) }; }
    async mutate(userId: string, id: string, dto: SaveExtensionDto | ExtensionMutationDto, action: 'save' | 'archive' | 'restore') {
        extensionId(id);
        if (id !== BUILTIN_EXTENSION)
            key(id);
        key(dto.requestKey);
        this.limit(userId, 'admin', 60);
        const value = action === 'save' ? dto as SaveExtensionDto : null;
        const normalized = value ? { title: value.title.trim(), description: value.description.trim(), entryUrl: extensionUrl(value.entryUrl.trim()), icon: value.icon, tone: value.tone, sort: value.sort, enabled: value.enabled, roles: value.roles, chatEnabled: value.chatEnabled, legacyBridge: value.legacyBridge, modelId: value.modelId || null } : null;
        if (normalized && !normalized.title)
            throw new BusinessException(ErrorCode.PARAM_INVALID, '请填写扩展名称。', 400);
        if (normalized && (id === BUILTIN_EXTENSION ? (normalized.entryUrl !== BUILTIN_URL || normalized.legacyBridge) : normalized.entryUrl === BUILTIN_URL))
            throw new BusinessException(ErrorCode.PARAM_INVALID, '内置画布请使用原有入口，外部工具请单独添加。', 400);
        const hash = extensionHash({ id, action, expectedVersion: dto.expectedVersion, value: normalized });
        return this.prisma.$transaction(async (tx) => {
            await this.lock(tx, userId);
            await this.user(tx, userId, true);
            if (id === BUILTIN_EXTENSION)
                await this.ensureBuiltin(tx);
            const current = await this.row(tx, id);
            if (current?.lastRequestKey === dto.requestKey) {
                if (current.lastRequestHash !== hash)
                    throw extensionConflict();
                return { ...view(current), enabled: current.enabled, archived: !!current.deletedAt, lastRequestKey: current.lastRequestKey };
            }
            if ((current?.version || 0) !== dto.expectedVersion || current && current.version >= 2147483647)
                throw extensionConflict();
            if (normalized?.modelId) {
                const configured = await tx.aiModel.findFirst({ where: { id: normalized.modelId, deletedAt: null, status: 'ENABLED' } });
                if (!configured || !configured.capabilities.split(',').map(value => value.trim()).includes('chat'))
                    throw new BusinessException(ErrorCode.PARAM_INVALID, '请选择支持文字对话的可用模型。', 400);
            }
            const now = new Date();
            if (action === 'save' && normalized) {
                if (current?.deletedAt)
                    throw extensionConflict();
                if (!current) {
                    const counts = await tx.$queryRaw<any[]> `SELECT count(*) AS n FROM "extensions"`;
                    if (Number(counts[0].n) >= 200)
                        throw new BusinessException(ErrorCode.PARAM_INVALID, '扩展数量已达到 200 个，请先整理已有扩展。', 400);
                    await tx.$executeRaw `INSERT INTO "extensions" ("id","title","description","entryUrl","icon","tone","sort","enabled","roles","chatEnabled","legacyBridge","modelId","version","lastRequestKey","lastRequestHash","createdAt","updatedAt") VALUES (${id},${normalized.title},${normalized.description},${normalized.entryUrl},${normalized.icon},${normalized.tone},${normalized.sort},${normalized.enabled},${normalized.roles},${normalized.chatEnabled},${normalized.legacyBridge},${normalized.modelId},1,${dto.requestKey},${hash},${now},${now})`;
                }
                else
                    await tx.$executeRaw `UPDATE "extensions" SET "title"=${normalized.title},"description"=${normalized.description},"entryUrl"=${normalized.entryUrl},"icon"=${normalized.icon},"tone"=${normalized.tone},"sort"=${normalized.sort},"enabled"=${normalized.enabled},"roles"=${normalized.roles},"chatEnabled"=${normalized.chatEnabled},"legacyBridge"=${normalized.legacyBridge},"modelId"=${normalized.modelId},"version"="version"+1,"lastRequestKey"=${dto.requestKey},"lastRequestHash"=${hash},"updatedAt"=${now} WHERE "id"=${id} AND "version"=${dto.expectedVersion}`;
            }
            else {
                if (!current)
                    throw extensionMissing();
                const deletedAt = action === 'archive' ? now : null;
                await tx.$executeRaw `UPDATE "extensions" SET "deletedAt"=${deletedAt},"version"="version"+1,"lastRequestKey"=${dto.requestKey},"lastRequestHash"=${hash},"updatedAt"=${now} WHERE "id"=${id} AND "version"=${dto.expectedVersion}`;
            }
            const saved = (await this.row(tx, id))!;
            return { ...view(saved), enabled: saved.enabled, archived: !!saved.deletedAt, lastRequestKey: saved.lastRequestKey };
        });
    }
    private async request(db: Db, userId: string, requestKey: string, includeDeleted = false) { key(requestKey); const rows = await db.$queryRaw<any[]> `SELECT r.*,c."deletedAt" AS "conversationDeletedAt",c."userId" AS "conversationOwner" FROM "extension_requests" r LEFT JOIN "conversations" c ON c."id"=r."conversationId" WHERE r."userId"=${userId} AND r."requestKey"=${requestKey}`; const row = requestRow(rows[0]); if (row?.conversationId && (row.conversationOwner !== userId || row.conversationDeletedAt && !includeDeleted))
        throw extensionMissing(); return row; }
    async prepare(userId: string, id: string, dto: PrepareExtensionRequestDto) {
        key(dto.requestKey);
        this.limit(userId, 'prepare');
        const prompt = dto.prompt.trim();
        if (!prompt)
            throw new BusinessException(ErrorCode.PARAM_INVALID, '先写下想让创作搭档帮忙的内容。', 400);
        const payloadHash = extensionHash({ id, prompt, quoteRevision: dto.quoteRevision });
        await this.prisma.$transaction(async (tx) => {
            await this.lock(tx, userId);
            await this.user(tx, userId);
            const old = await this.request(tx, userId, dto.requestKey);
            if (old) {
                if (old.state === 'ENDED')
                    return;
                if (old.payloadHash !== payloadHash)
                    throw extensionConflict();
                return;
            }
            const plan = await this.plan(tx, userId, id);
            if (plan.revision !== dto.quoteRevision)
                throw extensionConflict();
            if (id === BUILTIN_EXTENSION)
                await this.ensureBuiltin(tx);
            const conversationId = randomUUID(), now = new Date(), expires = new Date(Date.now() + 30 * 60000);
            await tx.conversation.create({ data: { id: conversationId, userId, modelId: plan.demoMode ? null : plan.model.id, title: ('扩展 · ' + plan.entry.title).slice(0, 60), params: JSON.stringify({ extensionRequestKey: dto.requestKey, extensionId: id }) } });
            await tx.$executeRaw `INSERT INTO "extension_requests" ("id","userId","requestKey","extensionId","extensionVersion","extensionTitle","entryUrl","conversationId","prompt","payloadHash","quoteRevision","modelId","modelName","state","expiresAt","createdAt","updatedAt") VALUES (${randomUUID()},${userId},${dto.requestKey},${id},${plan.entry.version},${plan.entry.title},${plan.entry.entryUrl},${conversationId},${prompt},${payloadHash},${dto.quoteRevision},${plan.model.id},${plan.model.name},'READY',${expires},${now},${now})`;
        });
        return this.receipt(userId, dto.requestKey);
    }
    async receipt(userId: string, requestKey: string) {
        this.limit(userId, 'receipt', 120);
        return this.prisma.$transaction(async (tx) => {
            await this.user(tx, userId);
            const row = await this.request(tx, userId, requestKey);
            if (!row)
                throw extensionMissing();
            if (row.state === 'ENDED')
                return { requestKey: row.requestKey, extensionId: null, extensionVersion: 0, extensionTitle: '扩展请求', conversationId: null, prompt: '', modelName: '', status: 'ENDED', messageId: null, content: '', billing: null, expiresAt: row.expiresAt.toISOString() };
            const user = row.conversationId ? await tx.message.findUnique({ where: { conversationId_clientMsgId: { conversationId: row.conversationId, clientMsgId: row.requestKey } } }) : null;
            if (user?.deletedAt)
                throw extensionMissing();
            const assistant = user ? await tx.message.findFirst({ where: { conversationId: row.conversationId, parentId: user.id, role: 'ASSISTANT', deletedAt: null, ...(row.messageId ? { id: row.messageId } : {}) }, orderBy: { createdAt: 'asc' } }) : null;
            if (row.messageId && !assistant)
                throw extensionMissing();
            return { requestKey: row.requestKey, extensionId: row.extensionId, extensionVersion: row.extensionVersion, extensionTitle: row.extensionTitle, conversationId: row.conversationId, prompt: row.prompt, modelName: row.modelName, status: assistant?.status || (row.expiresAt.getTime() <= Date.now() ? 'EXPIRED' : 'READY'), messageId: assistant?.id || null, content: assistant?.content || '', billing: assistant ? messageBilling(assistant) : null, expiresAt: row.expiresAt.toISOString() };
        });
    }
    async end(userId: string, requestKey: string) { key(requestKey); this.limit(userId, 'end', 60); await this.prisma.$transaction(async (tx) => { await this.lock(tx, userId); await this.user(tx, userId); const row = await this.request(tx, userId, requestKey, true), now = new Date(); if (!row) {
        await tx.$executeRaw `INSERT INTO "extension_requests" ("id","userId","requestKey","extensionId","extensionVersion","extensionTitle","entryUrl","conversationId","prompt","payloadHash","quoteRevision","modelId","modelName","state","expiresAt","createdAt","updatedAt") VALUES (${randomUUID()},${userId},${requestKey},NULL,0,'扩展请求','',NULL,'','','','','','ENDED',${now},${now},${now})`;
        return;
    } const message = row.conversationId && !row.conversationDeletedAt ? await tx.message.findUnique({ where: { conversationId_clientMsgId: { conversationId: row.conversationId, clientMsgId: row.requestKey } } }) : null; if (message && !message.deletedAt)
        throw new BusinessException(ErrorCode.PARAM_INVALID, '请求已接受，请先核对回复状态，再决定是否停止。', 409); await tx.$executeRaw `UPDATE "extension_requests" SET "state"='ENDED',"updatedAt"=${now} WHERE "id"=${row.id}`; }); return { requestKey, status: 'ENDED', extensionId: null, extensionVersion: 0, extensionTitle: '扩展请求', conversationId: null, prompt: '', modelName: '', messageId: null, content: '', billing: null, expiresAt: new Date().toISOString() }; }
    private async chatRequest(db: Db, userId: string, dto: ChatCompletionDto) {
        if (!dto.conversationId)
            throw new BusinessException(ErrorCode.PARAM_INVALID, '请先确认扩展请求。', 400);
        const row = await this.request(db, userId, dto.extensionRequestKey!);
        if (!row || row.conversationId !== dto.conversationId)
            throw extensionMissing();
        if (dto.clientMsgId !== row.requestKey || dto.appId || dto.appVersion !== undefined || dto.agentId || dto.agentParentId || dto.agentOfferRevision || dto.regenerateOf || dto.webSearch || dto.temperature !== undefined || dto.maxTokens !== undefined || dto.messages.length !== 1 || dto.messages[0].role !== 'user' || dto.messages[0].content !== row.prompt || dto.messages[0].attachments?.length || dto.model && dto.model !== row.modelName)
            throw new BusinessException(ErrorCode.PARAM_INVALID, '扩展只能使用本次已确认的问题和模型。', 400);
        return row;
    }
    async acceptedChat(userId: string, dto: ChatCompletionDto) {
        this.limit(userId, 'replay', 60);
        return this.prisma.$transaction(async tx => {
            await this.user(tx, userId);
            const row = await this.chatRequest(tx, userId, dto);
            if (!row.messageId) return null;
            const question = await tx.message.findUnique({ where: { conversationId_clientMsgId: { conversationId: row.conversationId, clientMsgId: row.requestKey } } });
            const reply = question && !question.deletedAt ? await tx.message.findFirst({ where: { id: row.messageId, parentId: question.id, conversationId: row.conversationId, role: 'ASSISTANT', deletedAt: null }, select: { id: true } }) : null;
            if (!reply) throw extensionMissing();
            return reply.id;
        });
    }
    async authorizeChat(userId: string, dto: ChatCompletionDto) {
        const row = await this.chatRequest(this.prisma, userId, dto);
        if (row.state !== 'READY' || row.expiresAt.getTime() <= Date.now())
            throw extensionConflict();
        const plan = await this.prisma.$transaction(tx => this.plan(tx, userId, row.extensionId));
        if (plan.revision !== row.quoteRevision || plan.model.name !== row.modelName)
            throw extensionConflict();
        return { requestKey: row.requestKey, userId, conversationId: row.conversationId, quoteRevision: row.quoteRevision, extensionId: row.extensionId, modelName: row.modelName, charge: plan.charge, demoMode: plan.demoMode };
    }
    async assertChatTx(tx: Db, admission: Awaited<ReturnType<ExtensionsService['authorizeChat']>>) { const row = await this.request(tx, admission.userId, admission.requestKey); if (!row || row.state !== 'READY' || row.expiresAt.getTime() <= Date.now())
        throw extensionConflict(); const plan = await this.plan(tx, admission.userId, admission.extensionId); if (plan.revision !== admission.quoteRevision)
        throw extensionConflict(); if (row.messageId && !await tx.message.findFirst({ where: { id: row.messageId, conversationId: row.conversationId, role: 'ASSISTANT', deletedAt: null } }))
        throw extensionMissing(); return row.messageId || null; }
    async bindChatTx(tx: Db, admission: Awaited<ReturnType<ExtensionsService['authorizeChat']>>, messageId: string) { const message = await tx.message.findFirst({ where: { id: messageId, conversationId: admission.conversationId, role: 'ASSISTANT', deletedAt: null } }); if (!message)
        throw extensionMissing(); await tx.$executeRaw `UPDATE "extension_requests" SET "messageId"=${messageId},"updatedAt"=${new Date()} WHERE "userId"=${admission.userId} AND "requestKey"=${admission.requestKey} AND "messageId" IS NULL`; const row = await this.request(tx, admission.userId, admission.requestKey); if (row?.messageId !== messageId)
        throw extensionConflict(); }
    async requireInitialRequestKey(userId: string, conversationId: string) { const rows = await this.prisma.$queryRaw<any[]> `SELECT "requestKey" FROM "extension_requests" WHERE "userId"=${userId} AND "conversationId"=${conversationId}`; if (!rows[0])
        return; const user = await this.prisma.message.findUnique({ where: { conversationId_clientMsgId: { conversationId, clientMsgId: rows[0].requestKey } } }); if (!user || user.deletedAt)
        throw new BusinessException(ErrorCode.PARAM_INVALID, '请先在扩展工作台完成首轮请求的确认。', 409); }
}
