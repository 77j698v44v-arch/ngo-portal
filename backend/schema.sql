-- NGO portal schema (PostgreSQL)

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Seat limit per leadership role. Chiefs can change these later.
CREATE TABLE IF NOT EXISTS role_limits (
  role       TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  seat_limit INT  NOT NULL CHECK (seat_limit >= 0),
  is_chief   BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  full_name     TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE,          -- the person's "Log in ID", stored lowercase
  phone         TEXT,                          -- used to verify them at FIRST TIME LOG IN
  password_hash TEXT,                          -- NULL until they set it at first-time log in
  password_set  BOOLEAN NOT NULL DEFAULT FALSE,-- once TRUE, first-time log in is closed for good
  role          TEXT NOT NULL REFERENCES role_limits(role),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role) WHERE active;

-- Upgrade path for databases created by the first version of this schema
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_set BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users DROP COLUMN IF EXISTS must_change_password;
UPDATE users SET password_set = TRUE WHERE password_hash IS NOT NULL AND password_set = FALSE;

-- CBO members admitted by leaders. A member only counts once a chief confirms payment.
CREATE TABLE IF NOT EXISTS members (
  id                SERIAL PRIMARY KEY,
  full_name         TEXT NOT NULL,
  phone             TEXT NOT NULL,
  national_id       TEXT,
  location          TEXT,
  admitted_by       INT NOT NULL REFERENCES users(id),
  status            TEXT NOT NULL DEFAULT 'pending_payment'
                    CHECK (status IN ('pending_payment','confirmed')),
  fee_amount        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  payment_method    TEXT NOT NULL DEFAULT 'mpesa' CHECK (payment_method IN ('mpesa','cash','bank')),
  payment_reference TEXT,
  commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,   -- referral commission locked in at confirmation
  confirmed_by      INT REFERENCES users(id),
  confirmed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_members_admitted_by ON members(admitted_by);
CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);
-- Same phone cannot be admitted twice
CREATE UNIQUE INDEX IF NOT EXISTS uq_members_phone ON members(phone);
-- Same M-Pesa/bank reference cannot be claimed for two members
CREATE UNIQUE INDEX IF NOT EXISTS uq_members_payment_ref ON members(payment_reference) WHERE payment_reference IS NOT NULL;

-- Income from the community projects, credited to a leader (or NGO general when earner_id is null)
CREATE TABLE IF NOT EXISTS income_records (
  id          SERIAL PRIMARY KEY,
  stream      TEXT NOT NULL CHECK (stream IN ('poshomill','public_transport','chicken_butcher')),
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  earner_id   INT REFERENCES users(id),
  record_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes       TEXT,
  recorded_by INT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  INT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_income_earner ON income_records(earner_id);
CREATE INDEX IF NOT EXISTS idx_income_stream ON income_records(stream);
CREATE INDEX IF NOT EXISTS idx_income_date ON income_records(record_date);

-- Activity log: everything that happens in the portal. Visible to the two chiefs only.
CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL PRIMARY KEY,
  actor_id   INT REFERENCES users(id),
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  INT,
  details    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);

INSERT INTO settings(key, value) VALUES
  ('max_recruiters', '200'),
  ('membership_fee', '500'),
  ('referral_commission', '100')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_limits(role, label, seat_limit, is_chief, sort_order) VALUES
  ('project_admin',         'Project Admin',            1,  TRUE,  1),
  ('project_coordinator',   'Project Coordinator',      1,  TRUE,  2),
  ('lead_chaplain',         'Lead Chaplain',            1,  FALSE, 3),
  ('deputy_lead_chaplain',  'Deputy Lead Chaplain',     2,  FALSE, 4),
  ('lead_coordinator',      'Lead Coordinator',         1,  FALSE, 5),
  ('deputy_lead_coordinator','Deputy Lead Coordinator', 2,  FALSE, 6),
  ('project_clerk',         'Project Clerk',            1,  FALSE, 7),
  ('proposal_writer',       'Proposal Writer',          2,  FALSE, 8),
  ('champion',              'Champion',                 13, FALSE, 9),
  ('till_champion',         'Till Champion',            12, FALSE, 10)
ON CONFLICT (role) DO NOTHING;
