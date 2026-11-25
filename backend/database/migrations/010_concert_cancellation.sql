-- Pembatalan konser mempertahankan seluruh relasi booking, payment, dan tiket.
ALTER TABLE public.concerts
    ADD COLUMN cancelled_at TIMESTAMPTZ,
    ADD COLUMN cancellation_reason VARCHAR(500);

ALTER TABLE public.concerts
    ADD CONSTRAINT concerts_cancellation_state_consistent CHECK (
        (cancelled_at IS NULL AND cancellation_reason IS NULL)
        OR (cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL
            AND length(trim(cancellation_reason)) > 0)
    );

CREATE INDEX concerts_cancelled_at_idx ON public.concerts (cancelled_at);
