import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import {accessibleAppWhere,publicAppWhere} from './app-visibility';

@Injectable()
export class AppsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------- 分类 ----------------
  listCategories() {
    return this.prisma.appCategory.findMany({ orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] });
  }

  async createCategory(name: string, sort = 0) {
    const exists = await this.prisma.appCategory.findUnique({ where: { name } });
    if (exists) throw new BusinessException(ErrorCode.PARAM_INVALID, '分类名已存在');
    return this.prisma.appCategory.create({ data: { name, sort } });
  }

  async updateCategory(id: string, data: { name?: string; sort?: number }) {
    const exists = await this.prisma.appCategory.findUnique({ where: { id } });
    if (!exists) throw new BusinessException(ErrorCode.NOT_FOUND, '分类不存在', 404);
    // 改名撞 unique 会抛 P2002，前端只会看到 500
    if (data.name) {
      const dup = await this.prisma.appCategory.findUnique({ where: { name: data.name } });
      if (dup && dup.id !== id) throw new BusinessException(ErrorCode.PARAM_INVALID, '分类名已存在');
    }
    return this.prisma.appCategory.update({ where: { id }, data });
  }

  async removeCategory(id: string) {
    const exists = await this.prisma.appCategory.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new BusinessException(ErrorCode.NOT_FOUND, '分类不存在', 404);
    await this.prisma.appCategory.delete({ where: { id } });
    return { ok: true };
  }

  /** 分类存在性：不校验的话错误 categoryId 会以 P2003 外键错误变成 500 */
  private async assertCategory(categoryId?: string | null) {
    if (!categoryId) return;
    const cat = await this.prisma.appCategory.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!cat) throw new BusinessException(ErrorCode.PARAM_INVALID, '分类不存在');
  }

  // ---------------- 应用 ----------------
  /** 前台：已发布 + 分类组织 */
  async listPublished(userId: string|undefined, categoryId?: string) {
    const apps = await this.prisma.app.findMany({
      where: {
        ...publicAppWhere(),
        ...(categoryId ? { categoryId } : {}),
      },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      include: { category: { select: { id: true, name: true } } },
    });

    const favorites = userId?await this.prisma.appFavorite.findMany({
      where: { userId },
      select: { appId: true },
    }):[];
    const favSet = new Set(favorites.map((f) => f.appId));

    return apps.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      icon: a.icon,
      greeting: a.greeting,
      defaultModel: a.defaultModel,
      category: a.category,
      favorited: favSet.has(a.id),
    }));
  }

  async detail(id: string, userId: string|undefined) {
    // 只暴露前台该看到的字段：systemPrompt 是内部提示词，绝不能随详情接口下发
    const app = await this.prisma.app.findFirst({
      where: userId?accessibleAppWhere(userId,id):{...publicAppWhere(),id},
      select: {
        id: true,
        name: true,
        description: true,
        icon: true,
        greeting: true,
        defaultModel: true,
        sort: true,
        published: true,
        version:true,
        shareId:true,
        category: { select: { id: true, name: true } },
      },
    });
    if (!app) throw new BusinessException(ErrorCode.NOT_FOUND, '应用不存在', 404);
    const fav = userId?await this.prisma.appFavorite.findUnique({
      where: { userId_appId: { userId, appId: id } },
    }):null;
    return { ...app, favorited: !!fav };
  }

  /** 内部使用：取 systemPrompt / 默认模型 */
  async getForChat(id:string,userId?:string){
    const app=await this.prisma.app.findFirst({where:userId?accessibleAppWhere(userId,id):{...publicAppWhere(),id}});
    if(!app)throw new BusinessException(ErrorCode.NOT_FOUND,'应用不存在或当前不可用',404);return app;
  }

  async toggleFavorite(userId: string, appId: string, wanted?: boolean) {
    return this.prisma.$transaction(async (tx) => {
      // Take the SQLite write lock before checking publication or the current favorite.
      // A raw no-op leaves the application's updatedAt and display order intact.
      await tx.$executeRaw`UPDATE "apps" SET "id" = "id" WHERE "id" = ${appId}`;
      const app = await tx.app.findFirst({
        where: {...publicAppWhere(),id:appId},
        select: { id: true },
      });
      if (!app) throw new BusinessException(ErrorCode.NOT_FOUND, '应用不存在', 404);
      const key = { userId_appId: { userId, appId } };
      const exists = await tx.appFavorite.findUnique({ where: key });
      // Explicit state is safe to retry; omitted state retains the older toggle API.
      const favorited = wanted ?? !exists;
      if (favorited && !exists) await tx.appFavorite.create({ data: { userId, appId } });
      else if (!favorited && exists) await tx.appFavorite.delete({ where: key });
      return { favorited };
    });
  }

  async listFavorites(userId: string) {
    const rows = await this.prisma.appFavorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    const apps = await this.prisma.app.findMany({
      where: { ...publicAppWhere(),id: { in: rows.map((r) => r.appId) } },
    });
    const map = new Map(apps.map((a) => [a.id, a]));
    return rows
      .map((r) => map.get(r.appId))
      .filter(Boolean)
      .map((a) => ({ id: a!.id, name: a!.name, icon: a!.icon, description: a!.description }));
  }

  // ---------------- 后台 ----------------
  adminList() {
    return this.prisma.app.findMany({
      where: { deletedAt: null,origin:'CURATED' },
      orderBy: [{ sort: 'asc' }, { createdAt: 'desc' }],
      include: { category: { select: { id: true, name: true } } },
    });
  }

  async create(data: {
    categoryId?: string;
    name: string;
    description?: string;
    icon?: string;
    systemPrompt: string;
    defaultModel?: string;
    greeting?: string;
    published?: boolean;
    sort?: number;
  }) {
    await this.assertCategory(data.categoryId);
    return this.prisma.app.create({ data });
  }

  async update(
    id: string,
    data: {
      categoryId?: string | null;
      name?: string;
      description?: string;
      icon?: string;
      systemPrompt?: string;
      defaultModel?: string | null;
      greeting?: string;
      published?: boolean;
      sort?: number;
    },
  ) {
    const exists = await this.prisma.app.findFirst({ where: { id, deletedAt: null }, select: { id: true,origin:true } });
    if (!exists) throw new BusinessException(ErrorCode.NOT_FOUND, '应用不存在', 404);
    if(exists.origin==='USER')throw new BusinessException(ErrorCode.PARAM_INVALID,'用户创建的应用请通过审核工作台处理',409);
    await this.assertCategory(data.categoryId);
    return this.prisma.app.update({ where: { id }, data:{...data,version:{increment:1}} });
  }

  async remove(id: string) {
    const exists = await this.prisma.app.findFirst({ where: { id, deletedAt: null }, select: { id: true,origin:true } });
    if (!exists) throw new BusinessException(ErrorCode.NOT_FOUND, '应用不存在', 404);
    if(exists.origin==='USER')throw new BusinessException(ErrorCode.PARAM_INVALID,'用户创建的应用请通过审核工作台处理',409);
    await this.prisma.app.update({ where: { id }, data: { deletedAt: new Date(), published: false,version:{increment:1} } });
    return { ok: true };
  }
}
