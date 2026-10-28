import { createServer } from "node:http";
import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { attachChatSocket } from "./socket";

const app = createApp();
const server = createServer(app);
attachChatSocket(server);

server.listen(env.PORT, () => {
  console.log(`🚀 U Mind Backend running on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
});

const handleShutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}. Gracefully shutting down...`);
  server.close(async () => {
    try {
      await prisma.$disconnect();
      console.log("Database connection closed.");
      process.exit(0);
    } catch (error) {
      console.error("Error during shutdown:", error);
      process.exit(1);
    }
  });
};

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));
