import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface MenuNode {
  id: string;
  title: string;
  path: string;
  icon: string | null;
  sort: number;
  children: MenuNode[];
}

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  private toNode(m: {
    id: string;
    title: string;
    path: string;
    icon: string | null;
    sort: number;
  }): MenuNode {
    return { id: m.id, title: m.title, path: m.path, icon: m.icon, sort: m.sort, children: [] };
  }

  /** 当前角色可见的菜单树 */
  async treeFor(role: string): Promise<MenuNode[]> {
    const rows = await this.prisma.menu.findMany({
      where: { visible: true },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });

    const visible = rows.filter((r) => {
      const roles = (r.roles ?? '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      // 留空（或写 ALL）表示对所有角色可见；否则按角色白名单过滤
      return roles.length === 0 || roles.includes('ALL') || roles.includes(role.toUpperCase());
    });

    const nodes = new Map(visible.map((r) => [r.id, this.toNode(r)]));
    const roots: MenuNode[] = [];

    for (const row of visible) {
      const node = nodes.get(row.id)!;
      if (row.parentId && nodes.has(row.parentId)) {
        nodes.get(row.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    // 没有子项的父节点仍保留（便于将来挂更多页面）
    return roots;
  }

  async all() {
    return this.prisma.menu.findMany({ orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] });
  }

  create(data: {
    parentId?: string | null;
    title: string;
    path: string;
    icon?: string;
    sort?: number;
    visible?: boolean;
    roles?: string;
  }) {
    return this.prisma.menu.create({
      data: {
        parentId: data.parentId ?? null,
        title: data.title,
        path: data.path,
        icon: data.icon,
        sort: data.sort ?? 0,
        visible: data.visible ?? true,
        roles: data.roles ?? 'ADMIN',
      },
    });
  }

  update(
    id: string,
    data: {
      parentId?: string | null;
      title?: string;
      path?: string;
      icon?: string;
      sort?: number;
      visible?: boolean;
      roles?: string;
    },
  ) {
    return this.prisma.menu.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.prisma.menu.delete({ where: { id } });
    return { ok: true };
  }
}
