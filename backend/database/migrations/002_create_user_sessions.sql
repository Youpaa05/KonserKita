CREATE TABLE user_sessions (
    session_token_hash CHAR(64) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT user_sessions_expiry_after_creation
        CHECK (expires_at > created_at)
);

CREATE INDEX user_sessions_user_id_idx
    ON user_sessions(user_id);

CREATE INDEX user_sessions_expiry_idx
    ON user_sessions(expires_at);

CREATE INDEX user_sessions_active_user_idx
    ON user_sessions(user_id, expires_at)
    WHERE revoked_at IS NULL;