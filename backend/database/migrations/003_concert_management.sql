-- Fase 05: Concert management.
-- Arsip menggunakan soft-delete agar relasi dan histori booking tetap utuh.
-- ID menggunakan PostgreSQL Identity Column dan dikelola otomatis oleh database.

ALTER TABLE public.concerts
    ADD COLUMN archived_at TIMESTAMPTZ;

CREATE INDEX concerts_archived_at_idx
    ON public.concerts (archived_at);