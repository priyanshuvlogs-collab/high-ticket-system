import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __bookedaiPrisma: PrismaClient | undefined;
}

/** Singleton Prisma client (safe across hot reloads in dev). */
export const prisma: PrismaClient =
  globalThis.__bookedaiPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__bookedaiPrisma = prisma;
}
