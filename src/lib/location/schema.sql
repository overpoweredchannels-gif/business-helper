-- Live Workforce Location Tracking Schema
-- Tables already exist in Supabase (staff_duty_sessions, staff_location_points).
-- This file documents the schema for reference.

-- staff_duty_sessions (already exists)
-- Stores employee duty sessions with GPS start/end coordinates
-- Columns: id, organization_id, profile_id, status, started_at, ended_at,
--   start_latitude, start_longitude, end_latitude, end_longitude,
--   start_accuracy, end_accuracy, notes, created_at, updated_at

-- staff_location_points (already exists)
-- Stores periodic GPS location uploads from employees
-- Columns: id, organization_id, profile_id, duty_session_id,
--   latitude, longitude, accuracy, speed, heading, altitude,
--   captured_at, created_at

-- No new tables needed. The existing Supabase tables are sufficient
-- for production-grade workforce location tracking.

-- Recommended indexes (create in Supabase dashboard if not present):
-- CREATE INDEX IF NOT EXISTS idx_location_points_org_captured
--   ON staff_location_points (organization_id, captured_at DESC);
-- CREATE INDEX IF NOT EXISTS idx_location_points_profile
--   ON staff_location_points (profile_id, captured_at DESC);
-- CREATE INDEX IF NOT EXISTS idx_duty_sessions_active
--   ON staff_duty_sessions (organization_id, status)
--   WHERE status = 'on_duty';
