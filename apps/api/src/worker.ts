import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

// The worker must use the exact database URL selected for this run, including its isolated schema.
{
  const explicit = process.env.DATABASE_URL;
  const fallback = process.env.SUPABASE_DATABASE_URL;
  let selected = explicit;
  if (fallback) {
    let explicitIsLocal = !explicit;
    if (explicit) {
      try {
        const host = new URL(explicit).hostname.toLowerCase();
        explicitIsLocal = host === "127.0.0.1" || host === "localhost" || host === "::1";
      } catch {
        explicitIsLocal = true;
      }
    }
    if (explicitIsLocal) selected = fallback;
  }
  if (selected) {
    const databaseUrl = new URL(selected);
    // Provider calls still run concurrently, while their database sealing and
    // checkpoint writes are queued instead of letting three Role Agents
    // deadlock each other through the Supabase transaction pool.
    databaseUrl.searchParams.set("connection_limit", "1");
    process.env.DATABASE_URL = databaseUrl.toString();
  }
}
// The same leased outbox service used by API nodes can also be run as a
// dedicated process.  This is intentionally HTTP-free so Railway/local
// process managers can scale API and worker independently.
async function bootstrap() {
  process.env.STORY_WORKER_PROCESS = "true";
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["log", "warn", "error"] });
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
