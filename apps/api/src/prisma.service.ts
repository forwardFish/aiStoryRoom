import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private databaseConnected = false;

  async onModuleInit() {
    // The v4 causal MVP uses its own durable file storage and must be runnable
    // without provisioning Postgres. Legacy database endpoints still connect when
    // DATABASE_URL is present and fail normally if called without configuration.
    if (!process.env.DATABASE_URL) return;
    await this.$connect();
    this.databaseConnected = true;
  }

  async onModuleDestroy() {
    if (!this.databaseConnected) return;
    await this.$disconnect();
  }
}
