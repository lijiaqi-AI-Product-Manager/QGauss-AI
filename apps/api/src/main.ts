import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { corsOrigins, parseTrustProxy } from './common/config/env.check';
import { securityHeaders } from './common/net/security-headers';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const cfg = app.get(ConfigService);

  const prefix = cfg.get<string>('API_PREFIX') ?? 'api';
  const production = cfg.get<string>('NODE_ENV') === 'production';
  app.setGlobalPrefix(prefix);
  app.set('trust proxy', parseTrustProxy(cfg.get<string>('TRUST_PROXY')));
  app.disable('x-powered-by');
  app.use(securityHeaders(production));
  const origins = corsOrigins(cfg.get<string>('CORS_ORIGINS'), production);
  app.enableCors({ origin: origins.length ? origins : false, credentials: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.enableShutdownHooks();

  // ---- 生产模式：同一个进程顺带托管前端构建产物 ----
  const webDist = cfg.get<string>('WEB_DIST') ?? join(process.cwd(), '..', 'web', 'dist');
  const indexHtml = join(webDist, 'index.html');
  if (existsSync(indexHtml)) {
    app.use(precompressedAssets(webDist));
    app.useStaticAssets(webDist, {
      index: false,
      setHeaders: (res: any, filePath: string) => res.setHeader('Cache-Control', cacheControlFor(filePath)),
    });
    app.use((req: any, res: any, next: () => void) => {
      if (req.path.startsWith(`/${prefix}`)) return next();
      // 资源缺失要明确 404：回退成 index.html 会让浏览器把 HTML 当 JS 解析，报一串看不懂的错
      if (req.path.startsWith('/assets/')) return res.status(404).end();
      res.setHeader('Cache-Control', 'no-cache');
    res.sendFile('index.html', { root: webDist });
    });
    Logger.log(`前端托管已启用: ${webDist}`, 'Bootstrap');
  }

  const port = Number(cfg.get<string>('PORT') ?? 9520);
  await app.listen(port, '0.0.0.0');
  Logger.log(`QGauss AI ready → http://127.0.0.1:${port}/${prefix}`, 'Bootstrap');
}

/** 文件名带内容哈希的产物可以永久缓存；其余（index.html 等）每次协商 */
function cacheControlFor(filePath: string) {
  return /[\\/]assets[\\/].+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(filePath)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}

/**
 * 构建时已生成 .br / .gz 副本：按 Accept-Encoding 直接发压缩件，省掉运行时压缩的 CPU，
 * 也不必引入全局 compression 中间件（它会缓冲 SSE，打断流式输出）。
 * 生产环境不对外提供 sourcemap。
 */
function precompressedAssets(webDist: string) {
  const prod = process.env.NODE_ENV === 'production';
  return (req: any, res: any, next: () => void) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    // 只认 assets 下的扁平文件名，正则本身就排除了 .. 与绝对路径
    const m = /^\/assets\/((?:chunks\/)?[\w.-]+)$/.exec(req.path);
    if (!m) return next();
    if (prod && m[1].endsWith('.map')) return res.status(404).end();
    const type = m[1].endsWith('.js') ? 'text/javascript; charset=utf-8' : m[1].endsWith('.css') ? 'text/css; charset=utf-8' : '';
    if (!type) return next();
    const accept = String(req.headers['accept-encoding'] ?? '');
    for (const [enc, ext] of [['br', '.br'], ['gzip', '.gz']] as const) {
      if (!accept.includes(enc)) continue;
      const file = join(webDist, 'assets', `${m[1]}${ext}`);
      if (!existsSync(file)) continue;
      res.setHeader('Content-Type', type);
      res.setHeader('Content-Encoding', enc);
      res.vary('Accept-Encoding');
      res.setHeader('Cache-Control', cacheControlFor(file.slice(0, -ext.length)));
      return res.sendFile(`assets/${m[1]}${ext}`, { root: webDist });
    }
    res.vary('Accept-Encoding');
    next();
  };
}

bootstrap().catch((error) => {
  Logger.error(error instanceof Error ? error.message : '应用启动失败', 'Bootstrap');
  process.exit(1);
});
