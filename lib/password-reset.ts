export const PASSWORD_MIN_LENGTH = 8;

export function passwordResetRedirect(origin: string): string {
  return new URL("/reset-password", origin).toString();
}

export function passwordValidationError(
  password: string,
  confirmation: string
): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Choose your own password with at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password !== confirmation) {
    return "The two passwords do not match.";
  }
  return null;
}
