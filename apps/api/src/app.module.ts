import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './common/config/env.check';
import { PrismaModule } from './common/prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { LlmModule } from './common/llm/llm.module';
import { RateLimitModule } from './common/ratelimit/rate-limit.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { HealthController } from './modules/health/health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ModelsModule } from './modules/models/models.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { ChatModule } from './modules/chat/chat.module';
import { SettingsModule } from './modules/settings/settings.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { PresetsModule } from './modules/presets/presets.module';
import { StorageModule } from './modules/storage/storage.module';
import { StatisticModule } from './modules/statistic/statistic.module';
import { MenuModule } from './modules/menu/menu.module';
import { FoldersModule } from './modules/folders/folders.module';
import { MailModule } from './modules/mail/mail.module';
import { AppsModule } from './modules/apps/apps.module';
import { ImageModule } from './modules/image/image.module';
import { ChatLogModule } from './modules/chatlog/chatlog.module';
import { CommerceModule } from './modules/commerce/commerce.module';
import { InstallationModule } from './modules/installation/installation.module';
import { InstallationGate } from './modules/installation/installation.guards';
import { VoiceModule } from './modules/voice/voice.module';
import { VideoModule } from './modules/video/video.module';
import { MjModule } from './modules/midjourney/mj.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'], validate: validateEnvironment }),
    PrismaModule,
    CryptoModule,
    LlmModule,
    RateLimitModule,
    InstallationModule,
    AuthModule,
    UsersModule,
    ModelsModule,
    ConversationsModule,
    ChatModule,
    SettingsModule,
    ModerationModule,
    PresetsModule,
    StorageModule,
    StatisticModule,
    MenuModule,
    FoldersModule,
    MailModule,
    AppsModule,
    ImageModule,
    ChatLogModule,
    CommerceModule,
    VoiceModule,
    VideoModule,
    MjModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: InstallationGate },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
