-- NeoWell v2 (1/2): new enum values. Kept separate because PostgreSQL cannot use
-- a newly added enum value inside the transaction that adds it.

ALTER TYPE "SkinColor" ADD VALUE 'FLUSHED';
ALTER TYPE "CryDescription" ADD VALUE 'NONE';
ALTER TYPE "FacilityService" ADD VALUE 'KANGAROO_CARE';
ALTER TYPE "ConsultationStatus" ADD VALUE 'AWAITING_PAYMENT';
ALTER TYPE "ConsultationStatus" ADD VALUE 'DECLINED';
ALTER TYPE "ConsultationStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUND_PENDING';
ALTER TYPE "PaymentProvider" ADD VALUE 'SANDBOX';
