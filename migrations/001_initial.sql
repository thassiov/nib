-- nib: initial schema
-- Run: psql -h postgres.grid.local -U grid_admin -d nib -f migrations/001_initial.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub         TEXT UNIQUE NOT NULL,
    username    TEXT NOT NULL,
    email       TEXT,
    avatar_url  TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE scenes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT 'Untitled',
    data        JSONB NOT NULL,
    thumbnail   TEXT,
    is_public   BOOLEAN DEFAULT false,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_scenes_user ON scenes(user_id);
CREATE INDEX idx_scenes_public ON scenes(is_public) WHERE is_public = true;
CREATE INDEX idx_scenes_updated ON scenes(updated_at DESC);
