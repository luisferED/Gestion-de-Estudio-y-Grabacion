CREATE TABLE IF NOT EXISTS auth_sessions (
 token text PRIMARY KEY NOT NULL,
 user_email text NOT NULL,
 expires_at text NOT NULL,
 created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
ALTER TABLE duty_assignments ADD COLUMN updated_by text DEFAULT '' NOT NULL;
ALTER TABLE duty_assignments ADD COLUMN updated_at text;
CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
