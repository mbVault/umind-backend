import { Response } from "express";

export const sendSuccess = <T>(res: Response, statusCode: number, data: T): void => {
  res.status(statusCode).json({ status: "success", data });
};
