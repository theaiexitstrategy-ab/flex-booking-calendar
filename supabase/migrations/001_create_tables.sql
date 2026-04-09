-- ═══════════════════════════════════════════════════════════════
-- The Flex Facility — Booking Calendar
-- Supabase Migration: Create all tables
-- © 2026 GoElev8.ai | Aaron Bryant. All rights reserved.
-- ═══════════════════════════════════════════════════════════════
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════════════

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ═══════════════════════════════════════
-- 1. CLIENTS TABLE
-- Multi-tenant client lookup
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert flex-facility client
INSERT INTO clients (slug, name)
VALUES ('flex-facility', 'The Flex Facility')
ON CONFLICT (slug) DO NOTHING;

-- ═══════════════════════════════════════
-- 2. LEADS TABLE
-- Contacts/leads from booking flow
-- If table already exists, add missing columns
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id),
  name TEXT,
  phone TEXT,
  email TEXT,
  source TEXT,
  funnel TEXT,
  status TEXT DEFAULT 'New',
  tags JSONB DEFAULT '[]'::jsonb,
  opted_out BOOLEAN DEFAULT FALSE,
  nudge_count INTEGER DEFAULT 0,
  last_nudge_sent TIMESTAMPTZ,
  booked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns that may be missing if the table already existed
ALTER TABLE leads ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS funnel TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'New';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS opted_out BOOLEAN DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS nudge_count INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_nudge_sent TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS booked_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Index for phone lookup (duplicate check)
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
-- Index for client filtering
CREATE INDEX IF NOT EXISTS idx_leads_client_id ON leads(client_id);
-- Index for nudge queries
CREATE INDEX IF NOT EXISTS idx_leads_nudge ON leads(opted_out, nudge_count, booked_at);

-- ═══════════════════════════════════════
-- 3. BOOKINGS TABLE
-- All booking records
-- If table already exists, add missing columns
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id),
  lead_id UUID REFERENCES leads(id),
  lead_name TEXT,
  phone TEXT,
  email TEXT,
  booking_date TEXT,
  service_type TEXT,
  status TEXT DEFAULT 'Confirmed',
  source TEXT DEFAULT 'book.theflexfacility.com',
  reminder_24h_sent BOOLEAN DEFAULT FALSE,
  reminder_2h_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns that may be missing if the table already existed
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS lead_name TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_date TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_type TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Confirmed';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'book.theflexfacility.com';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_24h_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_2h_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Index for status filtering (reminders, slot counts)
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
-- Index for client filtering
CREATE INDEX IF NOT EXISTS idx_bookings_client_id ON bookings(client_id);
-- Index for lead association
CREATE INDEX IF NOT EXISTS idx_bookings_lead_id ON bookings(lead_id);

-- ═══════════════════════════════════════
-- 4. TIME_SLOTS TABLE
-- Available/blocked/booked time slots
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS time_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id),
  slot_date DATE NOT NULL,
  slot_time TIME NOT NULL,
  is_available BOOLEAN DEFAULT TRUE,
  booked_by_lead_id UUID REFERENCES leads(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE time_slots ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
ALTER TABLE time_slots ADD COLUMN IF NOT EXISTS slot_date DATE;
ALTER TABLE time_slots ADD COLUMN IF NOT EXISTS slot_time TIME;
ALTER TABLE time_slots ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT TRUE;
ALTER TABLE time_slots ADD COLUMN IF NOT EXISTS booked_by_lead_id UUID REFERENCES leads(id);
ALTER TABLE time_slots ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Unique constraint: one slot per date+time per client
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_slots_unique
  ON time_slots(client_id, slot_date, slot_time);
-- Index for available slot queries
CREATE INDEX IF NOT EXISTS idx_time_slots_available
  ON time_slots(client_id, slot_date, is_available);

-- ═══════════════════════════════════════
-- 5. AVAILABILITY_TEMPLATES TABLE
-- Recurring weekly schedule for Coach Kenny
-- (Part 9 — Portal calendar management)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS availability_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_duration_minutes INTEGER DEFAULT 60,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint: one template per day per client per start time
CREATE UNIQUE INDEX IF NOT EXISTS idx_avail_template_unique
  ON availability_templates(client_id, day_of_week, start_time);

-- ═══════════════════════════════════════
-- 6. SMS_LOG TABLE
-- Audit trail for all SMS sent
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS sms_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  to_number TEXT,
  message_body TEXT,
  event_type TEXT,
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS to_number TEXT;
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS message_body TEXT;
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_sms_log_event_type ON sms_log(event_type);

-- ═══════════════════════════════════════
-- 7. ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════
-- Enable RLS on all tables
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_log ENABLE ROW LEVEL SECURITY;

-- Drop policies first if they exist (safe re-run)
DROP POLICY IF EXISTS "Public can read available time slots" ON time_slots;
DROP POLICY IF EXISTS "Public can read clients" ON clients;

-- For anon key access (frontend), allow reading available time slots:
CREATE POLICY "Public can read available time slots"
  ON time_slots FOR SELECT
  USING (is_available = true);

-- Anon key can read client info
CREATE POLICY "Public can read clients"
  ON clients FOR SELECT
  USING (true);

-- Service role handles all writes (API routes use supabaseAdmin).
-- No additional policies needed for inserts/updates since
-- the service role key bypasses RLS.

-- ═══════════════════════════════════════
-- 8. REALTIME
-- Enable realtime on time_slots for live
-- calendar updates on book.theflexfacility.com
-- ═══════════════════════════════════════
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE time_slots;
EXCEPTION WHEN duplicate_object THEN
  -- Table already in publication, skip
  NULL;
END $$;

-- ═══════════════════════════════════════
-- 9. SEED: DEFAULT AVAILABILITY TEMPLATES
-- Coach Kenny's recurring weekly schedule
-- ═══════════════════════════════════════
-- These match the current hardcoded schedule in index.html.
-- The portal can modify these later.

DO $$
DECLARE
  v_client_id UUID;
BEGIN
  SELECT id INTO v_client_id FROM clients WHERE slug = 'flex-facility';

  -- Sunday
  INSERT INTO availability_templates (client_id, day_of_week, start_time, end_time, slot_duration_minutes, is_active)
  VALUES (v_client_id, 0, '08:30', '09:30', 60, true)
  ON CONFLICT (client_id, day_of_week, start_time) DO NOTHING;

  INSERT INTO availability_templates (client_id, day_of_week, start_time, end_time, slot_duration_minutes, is_active)
  VALUES (v_client_id, 0, '09:30', '10:30', 60, true)
  ON CONFLICT (client_id, day_of_week, start_time) DO NOTHING;

  -- Monday
  INSERT INTO availability_templates (client_id, day_of_week, start_time, end_time, slot_duration_minutes, is_active)
  VALUES
    (v_client_id, 1, '16:00', '17:00', 60, true),
    (v_client_id, 1, '17:00', '18:00', 60, true),
    (v_client_id, 1, '18:00', '19:00', 60, true),
    (v_client_id, 1, '19:00', '20:00', 60, true)
  ON CONFLICT (client_id, day_of_week, start_time) DO NOTHING;

  -- Tuesday
  INSERT INTO availability_templates (client_id, day_of_week, start_time, end_time, slot_duration_minutes, is_active)
  VALUES
    (v_client_id, 2, '07:30', '08:30', 60, true),
    (v_client_id, 2, '08:00', '09:00', 60, true),
    (v_client_id, 2, '19:00', '20:00', 60, true)
  ON CONFLICT (client_id, day_of_week, start_time) DO NOTHING;

  -- Wednesday
  INSERT INTO availability_templates (client_id, day_of_week, start_time, end_time, slot_duration_minutes, is_active)
  VALUES
    (v_client_id, 3, '17:00', '18:00', 60, true),
    (v_client_id, 3, '18:00', '19:00', 60, true),
    (v_client_id, 3, '19:00', '20:00', 60, true)
  ON CONFLICT (client_id, day_of_week, start_time) DO NOTHING;

  -- Thursday
  INSERT INTO availability_templates (client_id, day_of_week, start_time, end_time, slot_duration_minutes, is_active)
  VALUES
    (v_client_id, 4, '07:30', '08:30', 60, true),
    (v_client_id, 4, '08:00', '09:00', 60, true)
  ON CONFLICT (client_id, day_of_week, start_time) DO NOTHING;

  -- Friday
  INSERT INTO availability_templates (client_id, day_of_week, start_time, end_time, slot_duration_minutes, is_active)
  VALUES
    (v_client_id, 5, '07:30', '08:30', 60, true),
    (v_client_id, 5, '08:30', '09:30', 60, true),
    (v_client_id, 5, '09:00', '10:00', 60, true)
  ON CONFLICT (client_id, day_of_week, start_time) DO NOTHING;

  -- Saturday
  INSERT INTO availability_templates (client_id, day_of_week, start_time, end_time, slot_duration_minutes, is_active)
  VALUES
    (v_client_id, 6, '07:00', '08:00', 60, true),
    (v_client_id, 6, '08:00', '09:00', 60, true),
    (v_client_id, 6, '09:00', '10:00', 60, true)
  ON CONFLICT (client_id, day_of_week, start_time) DO NOTHING;

END $$;

-- ═══════════════════════════════════════
-- DONE — Verify tables:
-- ═══════════════════════════════════════
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
