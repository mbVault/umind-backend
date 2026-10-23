import supertokens from "supertokens-node";
import Session from "supertokens-node/recipe/session";
import EmailPassword from "supertokens-node/recipe/emailpassword";
import { env } from "./env";

let initialized = false;

export const isSuperTokensConfigured = (): boolean => {
  return Boolean(env.SUPERTOKENS_CONNECTION_URI);
};

export const initSuperTokens = (): void => {
  if (initialized) {
    return;
  }
  if (!isSuperTokensConfigured()) {
    if (env.NODE_ENV === "test" && env.STAFF_AUTH_TEST_BYPASS) {
      return;
    }
    console.warn(
      "[SuperTokens] SUPERTOKENS_CONNECTION_URI not set — staff auth routes will reject sessions until configured."
    );
    return;
  }

  supertokens.init({
    framework: "express",
    supertokens: {
      connectionURI: env.SUPERTOKENS_CONNECTION_URI,
      apiKey: env.SUPERTOKENS_API_KEY || undefined,
    },
    appInfo: {
      appName: env.SUPERTOKENS_APP_NAME,
      apiDomain: env.SUPERTOKENS_API_DOMAIN,
      websiteDomain: env.SUPERTOKENS_WEBSITE_DOMAIN,
      apiBasePath: env.SUPERTOKENS_API_BASE_PATH,
      websiteBasePath: env.SUPERTOKENS_WEBSITE_BASE_PATH,
    },
    recipeList: [
      EmailPassword.init({
        override: {
          apis: (original) => ({
            ...original,
            // No public staff self-registration — accounts are provisioned / invited.
            signUpPOST: undefined,
          }),
        },
      }),
      Session.init(),
    ],
  });

  initialized = true;
};

export const getSuperTokensCorsHeaders = (): string[] => {
  return isSuperTokensConfigured() ? supertokens.getAllCORSHeaders() : [];
};
