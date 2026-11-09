import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { StorageModule } from '../storage/storage.module';
import { CozeClientService } from './coze-client.service';
import { AgentsService } from './agents.service';
import { AgentExecutionService } from './agent-execution.service';
import { AgentsController } from './agents.controller';
import {ArtifactSavesService} from './artifact-saves.service';

@Module({imports:[SettingsModule,StorageModule],controllers:[AgentsController],providers:[CozeClientService,AgentsService,AgentExecutionService,ArtifactSavesService],exports:[AgentsService,AgentExecutionService]})
export class AgentsModule {}
