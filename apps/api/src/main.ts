import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApiTransport } from "./api-transport";

// Supabase is the default shared test database whenever its connection is configured.
// This keeps ordinary local startup aligned with the configured test environment.
if (process.env.SUPABASE_DATABASE_URL) {
  const databaseUrl = new URL(process.env.SUPABASE_DATABASE_URL);
  // Supabase session-pool connections are deliberately small.  A local API
  // process must not reserve Prisma's default pool and starve a second local
  // preview or the three-player acceptance runner.
  if (!databaseUrl.searchParams.has("connection_limit")) databaseUrl.searchParams.set("connection_limit", "1");
  process.env.DATABASE_URL = databaseUrl.toString();
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
