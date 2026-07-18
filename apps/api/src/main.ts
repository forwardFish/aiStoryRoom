import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApiTransport } from "./api-transport";

// Supabase is the default shared test database, but an explicit remote DATABASE_URL wins so isolated acceptance schemas are preserved.
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
    if (!databaseUrl.searchParams.has("connection_limit")) databaseUrl.searchParams.set("connection_limit", "2");
    process.env.DATABASE_URL = databaseUrl.toString();
  }
}
async function bootstrap() {
  if (process.env.STORY_WORKER_ENABLED === undefined) process.env.STORY_WORKER_ENABLED = "true";
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApiTransport(app);
  app.setGlobalPrefix("api");
  const port = Number(process.env.PORT || process.env.API_PORT || 3001);
  await app.listen(port, "0.0.0.0");
  console.log(`AI Story Room API listening on http://localhost:${port}/api`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
