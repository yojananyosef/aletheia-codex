export type PasswordIssue = "short" | "long" | "weak" | null;

export const EMAIL_MAX_LENGTH = 254;

export function readFormString(
  form: FormData,
  name: string,
  maxLength = 512,
): string {
  const value = form.get(name);
  return typeof value === "string" ? value.slice(0, maxLength).trim() : "";
}

/** Passwords must be used verbatim: leading/trailing spaces are valid. */
export function readFormValue(
  form: FormData,
  name: string,
  maxLength = 512,
): string {
  const value = form.get(name);
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  if (!value || value.length > EMAIL_MAX_LENGTH) {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export function passwordIssue(
  password: string,
  minLength: number,
): PasswordIssue {
  if (password.length < minLength) {
    return "short";
  }
  // Supabase's bcrypt implementation only considers the first 72 bytes.
  if (Buffer.byteLength(password, "utf8") > 72) {
    return "long";
  }
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(password) || !/\d/.test(password)) {
    return "weak";
  }
  return null;
}
