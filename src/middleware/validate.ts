import { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodSchema, ZodError } from "zod";
import { HttpError } from "../lib/errors";

const zodToDetails = (error: ZodError): Record<string, string[]> => {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!details[key]) {
      details[key] = [];
    }
    details[key].push(issue.message);
  }
  return details;
};

export const validateBody =
  (schema: ZodSchema): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(new HttpError(400, "Validation failed", zodToDetails(result.error)));
      return;
    }
    req.body = result.data;
    next();
  };

export const validateQuery =
  (schema: ZodSchema): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(new HttpError(400, "Validation failed", zodToDetails(result.error)));
      return;
    }
    (req as Request & { validatedQuery: unknown }).validatedQuery = result.data;
    next();
  };

export const validateParams =
  (schema: ZodSchema): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(new HttpError(400, "Validation failed", zodToDetails(result.error)));
      return;
    }
    next();
  };
