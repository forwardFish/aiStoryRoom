import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

// The same leased outbox service used by API nodes can also be run as a
// dedicated process.  This is intentionally HTTP-free so Railway/local
// process managers can scale API and worker independently.
async function bootstrap() {
  process.env.STORY_WORKER_ENABLED = "true";
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["log", "warn", "error"] });
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
