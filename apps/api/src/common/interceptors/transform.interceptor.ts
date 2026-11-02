import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    return next.handle().pipe(
      map((data) => {
        // 已经是标准结构（如业务层直接 return { code, message, data }）则透传
        if (data && typeof data === 'object' && 'code' in data && 'message' in data) {
          return data;
        }
        return {
          code: 0,
          message: 'ok',
          data: data ?? null,
          traceId: req.headers['x-trace-id'] ?? undefined,
        };
      }),
    );
  }
}
