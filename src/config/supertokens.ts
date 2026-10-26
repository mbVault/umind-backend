import supertokens from "supertokens-node";
import Session from "supertokens-node/recipe/session";
import EmailPassword from "supertokens-node/recipe/emailpassword";
import ThirdParty from "supertokens-node/recipe/thirdparty";
import Passwordless from "supertokens-node/recipe/passwordless";
import { ProviderInput } from "supertokens-node/recipe/thirdparty/types";
import { env } from "./env";

let initialized = false;

export const isSuperTokensConfigured = (): boolean => {
  return Boolean(env.SUPERTOKENS_CONNECTION_URI);
};

export const isGoogleStaffAuthEnabled = (): boolean =>
  Boolean(env.STAFF_GOOGLE_CLIENT_ID.trim() && env.STAFF_GOOGLE_CLIENT_SECRET.trim());

export const isAppleStaffAuthEnabled = (): boolean =>
  Boolean(
    env.STAFF_APPLE_CLIENT_ID.trim() &&
      env.STAFF_APPLE_KEY_ID.trim() &&
      env.STAFF_APPLE_TEAM_ID.trim() &&
      env.STAFF_APPLE_PRIVATE_KEY.trim()
  );

/** Public flags for staff login UI (no secrets). */
export const getStaffAuthMethods = () => ({
  emailPassword: true,
  emailOtp: true,
  phoneOtp: true,
  google: isGoogleStaffAuthEnabled(),
  apple: isAppleStaffAuthEnabled(),
});

const normalizeApplePrivateKey = (raw: string): string => raw.replace(/\\n/g, "\n");

const buildThirdPartyProviders = (): ProviderInput[] => {
  const providers: ProviderInput[] = [];

  if (isGoogleStaffAuthEnabled()) {
    providers.push({
      config: {
        thirdPartyId: "google",
        clients: [
          {
            clientId: env.STAFF_GOOGLE_CLIENT_ID,
            clientSecret: env.STAFF_GOOGLE_CLIENT_SECRET,
          },
        ],
      },
    });
  }

  if (isAppleStaffAuthEnabled()) {
    providers.push({
      config: {
        thirdPartyId: "apple",
        clients: [
          {
            clientId: env.STAFF_APPLE_CLIENT_ID,
            additionalConfig: {
              keyId: env.STAFF_APPLE_KEY_ID,
              teamId: env.STAFF_APPLE_TEAM_ID,
              privateKey: normalizeApplePrivateKey(env.STAFF_APPLE_PRIVATE_KEY),
            },
          },
        ],
      },
    });
  }

  return providers;
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

  const thirdPartyProviders = buildThirdPartyProviders();
  if (!isGoogleStaffAuthEnabled()) {
    console.warn("[SuperTokens] Google staff login disabled — set STAFF_GOOGLE_CLIENT_ID/SECRET");
  }
  if (!isAppleStaffAuthEnabled()) {
    console.warn(
      "[SuperTokens] Apple staff login disabled — set STAFF_APPLE_CLIENT_ID/KEY_ID/TEAM_ID/PRIVATE_KEY"
    );
  }

  const recipeList = [
    EmailPassword.init({
      override: {
        apis: (original) => ({
          ...original,
          // No public staff self-registration — accounts are provisioned / invited.
          signUpPOST: undefined,
        }),
      },
    }),
    ...(thirdPartyProviders.length > 0
      ? [
          ThirdParty.init({
            signInAndUpFeature: {
              providers: thirdPartyProviders,
            },
          }),
        ]
      : []),
    Passwordless.init({
      contactMethod: "EMAIL_OR_PHONE",
      flowType: "USER_INPUT_CODE",
      // Dev/local: OTP is logged. Replace with SMTP/SMS providers before production.
      emailDelivery: {
        override: (original) => ({
          ...original,
          sendEmail: async (input) => {
            console.info(
              `[SuperTokens][email-otp] to=${input.email} code=${input.userInputCode ?? "(n/a)"}`
            );
          },
        }),
      },
      smsDelivery: {
        override: (original) => ({
          ...original,
          sendSms: async (input) => {
            console.info(
              `[SuperTokens][phone-otp] to=${input.phoneNumber} code=${input.userInputCode ?? "(n/a)"}`
            );
          },
        }),
      },
    }),
    Session.init(),
  ];

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
    recipeList,
  });

  initialized = true;
};

export const getSuperTokensCorsHeaders = (): string[] => {
  return isSuperTokensConfigured() ? supertokens.getAllCORSHeaders() : [];
};
