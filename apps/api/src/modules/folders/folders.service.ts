import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import {assertConversationActor} from '../conversations/conversation-state';

@Injectable()
export class FoldersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const folders = await this.prisma.conversationFolder.findMany({
      where: { userId },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' },{id:'asc'}],
    });
    if (folders.length === 0) return [];

    // 单独聚合会话数，避免在 schema 里为分组加关系（保持 provider 无关）
    const counts = await this.prisma.conversation.groupBy({
      by: ['folderId'],
      where: { userId, deletedAt: null, folderId: { in: folders.map((f) => f.id) } },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.folderId, c._count._all]));

    return folders.map((f) => ({
      id: f.id,
      version:f.version,
      name: f.name,
      sort: f.sort,
      createdAt: f.createdAt,
      conversationCount: countMap.get(f.id) ?? 0,
    }));
  }

  create(userId: string, name: string, sort = 0) {
    return this.prisma.$transaction(async tx=>{await assertConversationActor(tx,userId);return tx.conversationFolder.create({data:{userId,name:name.trim(),sort}});});
  }

  async update(userId: string, id: string, data: { name?: string; sort?: number;expectedVersion?:number }) {
    return this.prisma.$transaction(async tx=>{await assertConversationActor(tx,userId);await this.assertOwner(tx,userId,id,data.expectedVersion);return tx.conversationFolder.update({where:{id},data:{version:{increment:1},...(data.name!==undefined?{name:data.name.trim()}:{}),...(data.sort!==undefined?{sort:data.sort}:{})}});});
  }

  async remove(userId: string, id: string,expectedVersion?:number) {
    return this.prisma.$transaction(async tx=>{await assertConversationActor(tx,userId);await this.assertOwner(tx,userId,id,expectedVersion);const moved=await tx.conversation.updateMany({where:{folderId:id,userId},data:{folderId:null,version:{increment:1}}});await tx.conversationFolder.delete({where:{id}});return{ok:true,moved:moved.count};});
  }

  private async assertOwner(tx:any,userId: string, id: string,expectedVersion?:number) {
    const hit = await tx.conversationFolder.findFirst({
      where: { id, userId },
      select: { id: true,version:true },
    });
    if (!hit) throw new BusinessException(ErrorCode.NOT_FOUND, '分组不存在', 404);
    if(expectedVersion!==undefined&&hit.version!==expectedVersion)throw new BusinessException(ErrorCode.FOLDER_CHANGED,'这个分组已变化，请刷新后再操作。',409);return hit;
  }
}
