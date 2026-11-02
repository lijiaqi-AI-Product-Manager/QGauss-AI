import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecretBox } from './secret-box';

@Global()
@Module({
  providers: [
    {
      provide: SecretBox,
      useFactory: (cfg: ConfigService) =>
        new SecretBox(cfg.get<string>('APP_ENCRYPTION_KEY'), cfg.get<string>('JWT_SECRET')),
      inject: [ConfigService],
    },
  ],
  exports: [SecretBox],
})
export class CryptoModule {}
