import { Module } from '@nestjs/common';
import { ChatLogController } from './chatlog.controller';
import { ChatLogService } from './chatlog.service';

@Module({
  controllers: [ChatLogController],
  providers: [ChatLogService],
  exports: [ChatLogService],
})
export class ChatLogModule {}
