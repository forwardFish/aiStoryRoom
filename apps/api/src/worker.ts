import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configurePressureSupabaseDatabaseV1 } from "./pressure-chapter/production-config";

process.env.STORY_WORKER_PROCESS = "true";
// The API and dedicated worker must bind the same approved Supabase project.
// This runs before Nest constructs Prisma or any outbox consumer.
configurePressureSupabaseDatabaseV1(process.env, { connectionLimit: 1 });
// The same leased outbox service used by API nodes can also be run as a
// dedicated process.  This is intentionally HTTP-free so Railway/local
// process managers can scale API and worker independently.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["log", "warn", "error"] });
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
