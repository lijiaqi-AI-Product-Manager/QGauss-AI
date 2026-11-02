import {Module} from '@nestjs/common';
import {StorageModule} from '../storage/storage.module';
import {MjModule} from '../midjourney/mj.module';
import {VideoModule} from '../video/video.module';
import {GalleryController} from './gallery.controller';
import {GalleryService} from './gallery.service';

@Module({imports:[StorageModule,MjModule,VideoModule],controllers:[GalleryController],providers:[GalleryService],exports:[GalleryService]})
export class GalleryModule {}
