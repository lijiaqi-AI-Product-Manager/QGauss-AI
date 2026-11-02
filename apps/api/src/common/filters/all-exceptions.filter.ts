import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { detectLang, translateError } from '../i18n/messages';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const lang = detectLang(req.headers['accept-language'] as string | undefined);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 5000;
    let message = '服务器开小差了，请稍后再试';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as any;
      if (typeof body === 'string') {
        message = body;
        code = status;
      } else if (body && typeof body === 'object') {
        code = body.code ?? status;
        const m = body.message;
        message = Array.isArray(m) ? m.join('; ') : (m ?? exception.message);
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(`${req.method} ${req.url} → ${message}`, exception.stack);
    }

    // 只有请求声明英文时才覆盖文案；中文场景保留业务侧更具体的描述
    const localized = translateError(code, lang, message);

    // 响应头已发出（SSE 流、xlsx 流式导出等）：此时改状态码会抛 ERR_HTTP_HEADERS_SENT，
    // 既拿不到可读错误，又会污染日志。直接结束响应，把原因留在服务端日志里。
    if (res.headersSent) {
      this.logger.error(`${req.method} ${req.url} → 响应已开始，无法回写错误体: ${message}`);
      if (!res.writableEnded) res.end();
      return;
    }

    res.status(status).json({
      code,
      message: localized,
      data: null,
      path: req.url,
      timestamp: new Date().toISOString(),
      ...(lang === 'en' ? { lang } : {}),
    });
  }
}
