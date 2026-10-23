-- Web dashboard: optional email/password login for clinicians and admins.
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
