import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private databaseConnected = false;

  async onModuleInit() {
    // The v4 causal MVP uses its own durable file storage and must be runnable
    // without provisioning Postgres. Legacy database endpoints still connect when
    // DATABASE_URL is present and fail normally if called without configuration.
    if (process.env.DISABLE_PRISMA === "true" || !process.env.DATABASE_URL) return;
    await this.$connect();
    this.databaseConnected = true;
  }

  async onModuleDestroy() {
    if (!this.databaseConnected) return;
    await this.$disconnect();
  }

  async readiness() {
    if (!this.databaseConnected) return { ready: false, database: "not_configured" as const };
    try {
      await this.$queryRawUnsafe("SELECT 1");
      return { ready: true, database: "connected" as const };
    } catch {
      return { ready: false, database: "unavailable" as const };
    }
  }
}
