import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import { middleware as stMiddleware, errorHandler as stErrorHandler } from "supertokens-node/framework/express";
import { env } from "./config/env";
import { getSuperTokensCorsHeaders, initSuperTokens, isSuperTokensConfigured } from "./config/supertokens";
import { apiRouter } from "./routes";
import { errorHandler } from "./middleware/errorHandler";
import { notFoundHandler } from "./middleware/notFoundHandler";

export const createApp = (): Application => {
  initSuperTokens();

  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN === "*" ? "*" : env.CORS_ORIGIN.split(","),
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization", "X-Client-Platform", "X-Test-SuperTokens-User-Id", ...getSuperTokensCorsHeaders()],
    })
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  if (isSuperTokensConfigured()) {
    app.use(stMiddleware());
  }

  app.use("/api", apiRouter);

  app.use(notFoundHandler);

  if (isSuperTokensConfigured()) {
    app.use(stErrorHandler());
  }
  app.use(errorHandler);

  return app;
};
