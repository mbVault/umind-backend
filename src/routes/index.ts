import { Router } from "express";
import { authRouter } from "./auth";
import { profileRouter } from "./profile";
import { staffRouter } from "./staff";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/profile", profileRouter);
apiRouter.use("/v1/staff", staffRouter);
