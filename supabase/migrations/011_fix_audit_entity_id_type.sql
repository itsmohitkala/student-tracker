-- =====================================================================
-- AGUK Admin Dashboard — fix audit_events.entity_id type mismatch
-- Run in Supabase SQL Editor after 001-010.
--
-- Migration 010 fixed audit_events.student_id (uuid -> text) but missed
-- a second column on the same table: entity_id. Every call to
-- logAuditEvent() defaults entity_id to the student's own student_id
-- (a passport number, e.g. "E2ETEST1") whenever entityId isn't passed
-- explicitly — which is true for almost every call site (Approve,
-- Reject, Payment, REACH, Final Registration, Testing Tools, etc).
--
-- Confirmed live: a direct insert with entity_id: "E2ETEST1" throws
-- "invalid input syntax for type uuid" — meaning EVERY audit log write
-- has been silently failing (logAuditEvent only console.error's on
-- failure, never surfaces it to the user), even after migration 010.
-- This is why Audit History has appeared empty for every student.
--
-- entity_id is a generic polymorphic reference (entity_type varies:
-- 'students', 'test_form_events', etc.) with no FK constraint, so it
-- just needs to accept text like student_id does.
-- =====================================================================

alter table public.audit_events
  alter column entity_id type text using entity_id::text;

notify pgrst, 'reload schema';
