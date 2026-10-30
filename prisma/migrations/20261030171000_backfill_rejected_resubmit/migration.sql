-- Existing HR rejects were correctable by product default; map them to RESUBMIT.
UPDATE "PsychologistProfile"
SET "applicantNextAction" = 'RESUBMIT',
    "applicantMessage" = COALESCE("applicantMessage", "hrRejectionReason")
WHERE "hrApprovalStatus" = 'REJECTED'
  AND "identityOnboardingBlocked" = false
  AND "applicantNextAction" = 'WAIT';
