CREATE TABLE public.api_rate_limit_buckets (
    scope VARCHAR(80) NOT NULL,
    identity_hash CHAR(64) NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    reset_at TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT api_rate_limit_buckets_pkey
        PRIMARY KEY (scope, identity_hash, window_start),
    CONSTRAINT api_rate_limit_buckets_count_positive
        CHECK (request_count > 0),
    CONSTRAINT api_rate_limit_buckets_window_valid
        CHECK (reset_at > window_start)
);

CREATE INDEX api_rate_limit_buckets_reset_at_idx
    ON public.api_rate_limit_buckets (reset_at);

INSERT INTO public.digital_tickets (booking_id, ticket_number, ticket_code)
SELECT
    b.id,
    ticket.ticket_number,
    'KK-TKT-' || upper(
        replace(gen_random_uuid()::text, '-', '') ||
        replace(gen_random_uuid()::text, '-', '')
    )
FROM public.bookings b
JOIN public.payments p ON p.booking_id = b.id
CROSS JOIN LATERAL generate_series(1, b.quantity) AS ticket(ticket_number)
WHERE b.status = 'confirmed'
  AND p.status = 'paid'
  AND NOT EXISTS (
      SELECT 1
      FROM public.digital_tickets existing
      WHERE existing.booking_id = b.id
        AND existing.ticket_number = ticket.ticket_number
  )
ON CONFLICT DO NOTHING;
