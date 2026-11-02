import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { StatisticService } from './statistic.service';

@Controller('statistic')
export class StatisticController {
  constructor(private readonly statistic: StatisticService) {}

  @Roles('ADMIN')
  @Get('overview')
  overview(@Query('days') days = 7) {
    return this.statistic.overview(Number(days));
  }

  @Roles('ADMIN')
  @Get('by-model')
  byModel(@Query('days') days = 7) {
    return this.statistic.byModel(Number(days));
  }

  @Roles('ADMIN')
  @Get('by-channel')
  byChannel(@Query('days') days = 7) {
    return this.statistic.byChannel(Number(days));
  }

  @Roles('ADMIN')
  @Get('trend')
  trend(@Query('days') days = 7) {
    return this.statistic.trend(Number(days));
  }

  @Roles('ADMIN')
  @Get('errors')
  errors(@Query('limit') limit = 10) {
    return this.statistic.recentErrors(Number(limit));
  }

  @Roles('ADMIN')
  @Get('attempts')
  attempts(@Query('days') days = 7) {
    return this.statistic.attempts(Number(days));
  }
}
