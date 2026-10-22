const MIAMI_SUFFIX = "@miamioh.edu";

export function isMiamiEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return e.length > MIAMI_SUFFIX.length && e.endsWith(MIAMI_SUFFIX);
}
