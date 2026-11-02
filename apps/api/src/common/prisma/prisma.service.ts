import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);
  private dataLease?: { close(): void };

  async onModuleInit() {
    const { sqliteFileFromUrl, acquireDataLease } = require('../../../prisma/data-lease.cjs');
    const file = sqliteFileFromUrl();
    if (file) this.dataLease = acquireDataLease(file);
    try { await this.$connect(); }
    catch (error) { this.dataLease?.close(); this.dataLease = undefined; throw error; }
    this.logger.log('database connected');
  }

  // Workers finish their module shutdown hooks before database access and its lease close.
  async onApplicationShutdown() {
    try { await this.$disconnect(); }
    finally { this.dataLease?.close(); this.dataLease = undefined; }
  }
}
