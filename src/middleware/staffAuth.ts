import { Request, Response, NextFunction } from "express";
import Session from "supertokens-node/recipe/session";
import { StaffRole } from "@prisma/client";
import { env } from "../config/env";
import { fail } from "../lib/errors";
import { isSuperTokensConfigured } from "../config/supertokens";
import {
  StaffAccountContext,
  accountHasRole,
  assertActiveAdminMembership,
  assertAdminPermission,
  loadStaffAccountBySuperTokensUserId,
} from "../modules/staff/accountLoader";

export interface StaffAuthenticatedRequest extends Request {
  staff: {
    superTokensUserId: string;
    account: StaffAccountContext;
  };
}

const resolveSuperTokensUserId = async (req: Request, res: Response): Promise<string> => {
  if (env.NODE_ENV === "test" && env.STAFF_AUTH_TEST_BYPASS) {
    const testId = req.header("x-test-supertokens-user-id");
    if (testId) {
      return testId.trim();
    }
  }

  if (!isSuperTokensConfigured()) {
    fail(503, "Staff authentication is not configured");
  }

  const session = await Session.getSession(req, res, { sessionRequired: true });
  return session.getUserId();
};

export const requireStaffAccount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const superTokensUserId = await resolveSuperTokensUserId(req, res);
    const account = await loadStaffAccountBySuperTokensUserId(superTokensUserId);
    (req as StaffAuthenticatedRequest).staff = { superTokensUserId, account };
    next();
  } catch (err) {
    next(err);
  }
};

export const requireStaffRole = (role: StaffRole) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const { account } = (req as StaffAuthenticatedRequest).staff;
      if (!accountHasRole(account, role)) {
        fail(403, `${role} role required`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
};

export const requireAdminPermission = (permission: string) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const { account } = (req as StaffAuthenticatedRequest).staff;
      assertAdminPermission(account, permission);
      next();
    } catch (err) {
      next(err);
    }
  };
};

export const requireActiveAdmin = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    assertActiveAdminMembership((req as StaffAuthenticatedRequest).staff.account);
    next();
  } catch (err) {
    next(err);
  }
};
