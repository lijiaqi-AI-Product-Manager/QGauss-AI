import { Global, Module } from '@nestjs/common';
import { BreakerRegistry } from './breaker';

/**
 * LLM 运行时能力（熔断器注册表）。
 * 全局模块，Models / Chat 都直接注入，不重复实例化。
 */
@Global()
@Module({
  providers: [
    {
      provide: BreakerRegistry,
      useFactory: () => new BreakerRegistry(),
    },
  ],
  exports: [BreakerRegistry],
})
export class LlmModule {}
