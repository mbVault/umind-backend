import { fail } from "./errors";

export const param = (value: string | string[] | undefined, name: string): string => {
  if (typeof value !== "string" || !value) {
    fail(400, `Missing route parameter: ${name}`);
  }
  return value;
};
