-- Keep the validated ID token and discovered logout endpoint only for this local session.
ALTER TABLE auth_sessions ADD COLUMN id_token_hint text DEFAULT '' NOT NULL;
ALTER TABLE auth_sessions ADD COLUMN end_session_endpoint text DEFAULT '' NOT NULL;
