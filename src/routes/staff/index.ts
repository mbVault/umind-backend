import { Router } from "express";
import { staffMeRouter } from "./me";
import { staffAuthMethodsRouter } from "./authMethods";
import { staffAccessRouter } from "./access";
import { psychologistRouter } from "./psychologist";
import { adminPsychologistsRouter } from "./adminPsychologists";
import { adminMembersRouter } from "./adminMembers";
import { adminComplaintsRouter } from "./adminComplaints";
import { adminAudioRouter } from "./adminAudio";
import { invitationsRouter } from "./invitations";

export const staffRouter = Router();

staffRouter.use("/auth/methods", staffAuthMethodsRouter);
staffRouter.use("/access", staffAccessRouter);
staffRouter.use("/me", staffMeRouter);
staffRouter.use("/psychologist", psychologistRouter);
staffRouter.use("/admin/psychologists", adminPsychologistsRouter);
staffRouter.use("/admin/complaints", adminComplaintsRouter);
staffRouter.use("/admin/audio", adminAudioRouter);
staffRouter.use("/admin", adminMembersRouter);
staffRouter.use("/invitations", invitationsRouter);
