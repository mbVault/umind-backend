import { Router } from "express";
import { staffMeRouter } from "./me";
import { psychologistRouter } from "./psychologist";
import { adminPsychologistsRouter } from "./adminPsychologists";
import { adminMembersRouter } from "./adminMembers";
import { invitationsRouter } from "./invitations";

export const staffRouter = Router();

staffRouter.use("/me", staffMeRouter);
staffRouter.use("/psychologist", psychologistRouter);
staffRouter.use("/admin/psychologists", adminPsychologistsRouter);
staffRouter.use("/admin", adminMembersRouter);
staffRouter.use("/invitations", invitationsRouter);
