// Admins bypass credit deduction. Checked at ingest time — if the user is
// an admin we still record the CreditTransaction with reason="admin_grant"
// for auditability, but don't decrement.

import { prisma } from "./db";

const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS ?? "shreyas.pavuluri@gmail.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.has(email.toLowerCase());
}

const adminCache = new Map<string, boolean>();

export async function isAdminUser(userId: string): Promise<boolean> {
  const cached = adminCache.get(userId);
  if (cached !== undefined) return cached;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  const admin = isAdminEmail(user?.email);
  adminCache.set(userId, admin);
  return admin;
}
