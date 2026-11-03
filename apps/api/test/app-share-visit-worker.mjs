import 'reflect-metadata';
import {SqliteClient} from '../dist/common/prisma/sqlite-client.js';
import {RateLimitService} from '../dist/common/ratelimit/rate-limit.service.js';
import {AppShareViewsService} from '../dist/modules/apps/app-share-views.service.js';
const [database,shareId,requestKey]=process.argv.slice(2),db=new SqliteClient({datasources:{db:{url:'file:'+database.replaceAll('\\','/')}}});
try{const service=new AppShareViewsService(db,new RateLimitService());console.log(JSON.stringify(await service.record(shareId,requestKey,'worker')));}finally{await db.$disconnect();}
