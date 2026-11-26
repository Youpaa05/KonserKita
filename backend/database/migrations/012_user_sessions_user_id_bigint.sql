ALTER TABLE public.user_sessions
    DROP CONSTRAINT user_sessions_user_id_fkey;

ALTER TABLE public.user_sessions
    ALTER COLUMN user_id TYPE BIGINT
    USING user_id::BIGINT;

ALTER TABLE public.user_sessions
    ADD CONSTRAINT user_sessions_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES public.users(id)
    ON DELETE CASCADE;
