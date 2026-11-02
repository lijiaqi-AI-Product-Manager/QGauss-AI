import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretBox } from '../../common/crypto/secret-box';
import { KeyPoolService } from '../models/key-pool.service';
import type { VideoRoute } from './video.provider';
import { videoEndpoint } from './video-protocol';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
@Injectable()
export class VideoConnectionService {
  constructor(private readonly prisma: PrismaService, private readonly box: SecretBox, private readonly pool: KeyPoolService) {}
  async channel(id: string) { return this.prisma.channel.findFirst({ where: { id, type: 'OPENAI', status: 'ENABLED', deletedAt: null } }); }
  async pick(channelId: string, upstreamModel: string, profile: string) {
    const channel = await this.channel(channelId); if (!channel) throw Error('视频原连接暂不可用');
    videoEndpoint(channel.baseUrl, profile, 'submit');
    const primary = channel.apiKeyEnc ? this.box.decrypt(channel.apiKeyEnc) : '', key = await this.pool.pick({ id: channel.id, apiKey: primary });
    if (!key) throw Error('视频原连接没有可用密钥');
    const route: VideoRoute = { channelId: channel.id, baseUrl: channel.baseUrl, timeoutMs: Math.min(120000, Math.max(1000, channel.timeoutMs)), keyId: key.id, keyHash: hash(key.apiKey), upstreamModel };
    return { route, key: key.apiKey };
  }
  async pinned(route: VideoRoute) {
    const channel = await this.channel(route.channelId); if (!channel || channel.baseUrl !== route.baseUrl) throw Error('视频原连接已变更，等待恢复或人工核对');
    let secret = channel.apiKeyEnc;
    if (route.keyId) { const slot = await this.prisma.channelKey.findFirst({ where: { id: route.keyId, channelId: channel.id, status: 'ENABLED' } }); if (!slot) throw Error('视频原密钥槽已停用，等待恢复或人工核对'); secret = slot.keyEnc; }
    const key = secret ? this.box.decrypt(secret) : '';
    if (!key && route.keyHash !== hash('')) throw Error('视频原密钥已移除，等待恢复或人工核对');
    // Rotate a key in the same explicit slot, never pick another pool account for a known job.
    return { route, key };
  }
  async authorizationFailure(route: VideoRoute) {
    if (route.keyId) await this.pool.reportFailure(route.channelId, { id: route.keyId, ref: route.keyId, apiKey: '', weight: 1 }, 'upstream_auth');
  }
}
