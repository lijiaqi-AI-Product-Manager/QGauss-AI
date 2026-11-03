import {Module} from '@nestjs/common';
import {ModelsModule} from '../models/models.module';
import {CommerceModule} from '../commerce/commerce.module';
import {ModerationModule} from '../moderation/moderation.module';
import {MindmapController} from './mindmap.controller';
import {MindmapDocumentsService} from './mindmap-documents.service';
import {MindmapGenerationsService} from './mindmap-generations.service';
import {MindmapAccountingService} from './mindmap-accounting.service';

@Module({imports:[ModelsModule,CommerceModule,ModerationModule],controllers:[MindmapController],providers:[MindmapDocumentsService,MindmapGenerationsService,MindmapAccountingService]})
export class MindmapModule {}
