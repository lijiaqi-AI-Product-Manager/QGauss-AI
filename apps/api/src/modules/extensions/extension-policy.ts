import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
export const BUILTIN_EXTENSION = 'qgauss-idea-canvas';
export const BUILTIN_URL = '/extensions/idea-canvas.html';
export const extensionHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const extensionMissing = () => new BusinessException(ErrorCode.NOT_FOUND, '这个扩展暂时不可用，请返回工作台重新选择。', 404);
export const extensionConflict = () => new BusinessException(ErrorCode.PARAM_INVALID, '扩展或模型设定已经变化，请重新核对后再继续。', 409);
export function extensionId(value: unknown) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new BusinessException(ErrorCode.PARAM_INVALID, '扩展标识无效。', 400); return value; }
export function extensionUrl(value: string, allowLocal = process.env.NODE_ENV === 'test') {
    if (value === BUILTIN_URL)
        return value;
    let url: URL;
    try {
        url = new URL(value);
    }
    catch {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '请填写完整的 HTTPS 扩展地址。', 400);
    }
    const host = url.hostname.toLowerCase().replace(/\.$/, ''), local = allowLocal && url.protocol === 'http:' && host === '127.0.0.1';
    if (!local && (url.protocol !== 'https:' || isIP(host.replace(/^\[|\]$/g, '')) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) || url.username || url.password || value.length > 2000 || /[\u0000-\u0020\u007f\\]/.test(value) || [...url.searchParams.keys()].some(key => /^(?:token|access_token|api_?key|secret|password)$/i.test(key)))
        throw new BusinessException(ErrorCode.PARAM_INVALID, '请使用独立扩展域名的 HTTPS 地址，地址中不要填写登录凭据。', 400);
    return url.href;
}
export const builtinExtension = () => ({ id: BUILTIN_EXTENSION, title: 'QGauss 灵感便签', description: '把一个小念头放进画布，让创作搭档帮你展开。', entryUrl: BUILTIN_URL, icon: 'mindmap', tone: 'violet', sort: 0, enabled: true, roles: 'USER,ADMIN', chatEnabled: true, legacyBridge: false, modelId: null as string | null, version: 1, lastRequestKey: null as string | null, lastRequestHash: null as string | null, deletedAt: null as Date | null, createdAt: new Date(0), updatedAt: new Date(0) });
export type ExtensionEntry = ReturnType<typeof builtinExtension>;
