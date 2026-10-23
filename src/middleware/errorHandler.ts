import { Request, Response, NextFunction } from "express";
import { HttpError } from "../lib/errors";

export interface AppError extends Error {
  statusCode?: number;
  details?: unknown;
}

export const errorHandler = (
  err: AppError | HttpError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const isProduction = process.env.NODE_ENV === "production";

  if (err instanceof HttpError) {
    // 503 is used for intentionally unavailable integrations (e.g. object storage).
    if (err.statusCode >= 500 && err.statusCode !== 503) {
      console.error(`[Error] ${err.name}: ${err.message}`, err.stack);
    }
    res.status(err.statusCode).json({
      status: "fail",
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  const statusCode = err.statusCode || 500;
  console.error(`[Error] ${err.name}: ${err.message}`, err.stack);

  res.status(statusCode).json({
    status: statusCode >= 500 ? "error" : "fail",
    message: statusCode === 500 && isProduction ? "Internal server error" : err.message,
    ...(err.details ? { details: err.details } : {}),
    ...(!isProduction && err.stack ? { stack: err.stack } : {}),
  });
};
