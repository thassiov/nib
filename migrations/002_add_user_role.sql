-- Add role column to users table
-- Values: 'admin', 'user'
-- Default is 'user' for all existing and new users

ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
