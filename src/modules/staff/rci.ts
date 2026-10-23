/** Normalize RCI registration numbers for storage and uniqueness. */
export const normalizeRciNumber = (input: string): string => {
  return input.trim().toUpperCase().replace(/\s+/g, "");
};

export const isValidRciNumber = (normalized: string): boolean => {
  // Product-spec format is not rigidly documented; enforce a conservative alphanumeric shape.
  return /^[A-Z0-9\/\-]{5,64}$/.test(normalized);
};

export const normalizeAadhaarLast4 = (input: string): string | null => {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 4) {
    return digits;
  }
  if (digits.length === 12) {
    // Reject full numbers — callers must only send last 4.
    return null;
  }
  return null;
};

export const looksLikeFullAadhaar = (input: string): boolean => {
  const digits = input.replace(/\D/g, "");
  return digits.length >= 12;
};
