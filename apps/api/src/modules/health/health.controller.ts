import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { InstallationAllowed } from '../../common/decorators/installation-allowed.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * 健康检查分两个语义，别混用：
 *   - GET /health         存活（liveness）：进程还在、事件循环没堵死。绝不能依赖外部服务，
 *                         否则数据库抖一下 k8s 就会把整个 Pod 重启，反而放大故障。
 *   - GET /health/ready   就绪（readiness）：能不能接流量。会真的探一下数据库与对象存储，
 *                         不过就把它从负载均衡里摘掉（不重启）。
 */
@Controller('health')
@InstallationAllowed()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get()
  check() {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      version: '0.1.0',
      time: new Date().toISOString(),
    };
  }

  @Public()
  @Get('ready')
  async ready() {
    let db = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }

    const storage = await this.storage.probe();
    const ok = db === 'up' && storage.ok;

    return {
      status: ok ? 'ok' : 'degraded',
      db,
      storage,
      uptime: Math.round(process.uptime()),
      time: new Date().toISOString(),
    };
  }
}
