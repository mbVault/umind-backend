const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?\d[\d\s\-()]{7,}$/;

export const validateAlias = (alias: string): string | null => {
  const trimmed = alias.trim();
  if (trimmed.length < 2 || trimmed.length > 20) {
    return "Alias must be between 2 and 20 characters";
  }
  if (EMAIL_PATTERN.test(trimmed)) {
    return "Alias must not look like an email address";
  }
  if (PHONE_PATTERN.test(trimmed.replace(/\s/g, ""))) {
    return "Alias must not look like a phone number";
  }
  return null;
};
