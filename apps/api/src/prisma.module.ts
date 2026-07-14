import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/** One process-wide Prisma client. Module-local registrations would each open
 * their own connection pool and exhaust Supabase's session-pool limit. */
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
