import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApiTransport } from "./api-transport";

// Supabase is the default shared test database whenever its connection is configured.
// This keeps ordinary local startup aligned with the configured test environment.
if (process.env.SUPABASE_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.SUPABASE_DATABASE_URL;
}

async function bootstrap() {
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
