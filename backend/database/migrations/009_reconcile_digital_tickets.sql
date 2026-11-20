DO $migration$
DECLARE
    v_booking_id BIGINT;
    v_booking_status VARCHAR(20);
    v_payment_status VARCHAR(20);
    v_quantity INTEGER;
    v_ticket_number INTEGER;
    v_ticket_count BIGINT;
    v_distinct_ticket_count BIGINT;
    v_min_ticket_number INTEGER;
    v_max_ticket_number INTEGER;
    v_constraint_name TEXT;
BEGIN
    -- The booking row is shared with payment transitions and ticket issuance.
    PERFORM b.id
    FROM public.payments AS p
    JOIN public.bookings AS b ON b.id = p.booking_id
    WHERE b.status = 'confirmed'
      AND p.status = 'paid'
      AND EXISTS (
          SELECT 1
          FROM generate_series(1, b.quantity) AS expected(ticket_number)
          WHERE NOT EXISTS (
              SELECT 1
              FROM public.digital_tickets AS existing
              WHERE existing.booking_id = b.id
                AND existing.ticket_number = expected.ticket_number
          )
      )
    ORDER BY b.id
    FOR UPDATE OF b;

    SELECT b.id, b.status, p.status
    INTO v_booking_id, v_booking_status, v_payment_status
    FROM public.bookings AS b
    LEFT JOIN public.payments AS p ON p.booking_id = b.id
    WHERE p.id IS NULL
       OR NOT (
            (b.status = 'pending' AND p.status = 'pending')
            OR (b.status = 'confirmed' AND p.status = 'paid')
            OR (b.status = 'cancelled' AND p.status IN ('failed', 'expired'))
       )
    ORDER BY b.id
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION USING
            MESSAGE = format(
                'Migration 009 aborted: booking %s has inconsistent booking/payment statuses (%s/%s).',
                v_booking_id,
                v_booking_status,
                COALESCE(v_payment_status, '<missing payment>')
            ),
            HINT = 'Reconcile the booking and payment manually; this migration does not change either status.';
    END IF;

    SELECT b.id, b.quantity, t.ticket_number
    INTO v_booking_id, v_quantity, v_ticket_number
    FROM public.bookings AS b
    JOIN public.payments AS p ON p.booking_id = b.id
    JOIN public.digital_tickets AS t ON t.booking_id = b.id
    WHERE b.status = 'confirmed'
      AND p.status = 'paid'
      AND (t.ticket_number < 1 OR t.ticket_number > b.quantity)
    ORDER BY b.id, t.ticket_number
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION USING
            MESSAGE = format(
                'Migration 009 aborted: booking %s has ticket number %s outside the expected range 1..%s.',
                v_booking_id,
                v_ticket_number,
                v_quantity
            ),
            HINT = 'Reconcile the extra ticket manually; this migration does not delete or change existing tickets.';
    END IF;

    BEGIN
        INSERT INTO public.digital_tickets (booking_id, ticket_number, ticket_code)
        SELECT
            b.id,
            ticket.ticket_number,
            'KK-TKT-' || upper(
                replace(gen_random_uuid()::text, '-', '') ||
                replace(gen_random_uuid()::text, '-', '')
            )
        FROM public.bookings AS b
        JOIN public.payments AS p ON p.booking_id = b.id
        CROSS JOIN LATERAL generate_series(1, b.quantity) AS ticket(ticket_number)
        WHERE b.status = 'confirmed'
          AND p.status = 'paid'
          AND NOT EXISTS (
              SELECT 1
              FROM public.digital_tickets AS existing
              WHERE existing.booking_id = b.id
                AND existing.ticket_number = ticket.ticket_number
          )
        ON CONFLICT (booking_id, ticket_number) DO NOTHING;
    EXCEPTION
        WHEN unique_violation THEN
            GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;

            IF v_constraint_name = 'digital_tickets_code_unique' THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23505',
                    CONSTRAINT = v_constraint_name,
                    MESSAGE = 'Migration 009 aborted: a generated ticket_code conflicts with an existing ticket.',
                    HINT = 'No ticket_code conflict is ignored; the transaction must be retried after investigation.';
            END IF;

            RAISE;
    END;

    SELECT
        b.id,
        b.quantity,
        COUNT(t.id),
        COUNT(DISTINCT t.ticket_number),
        MIN(t.ticket_number),
        MAX(t.ticket_number)
    INTO
        v_booking_id,
        v_quantity,
        v_ticket_count,
        v_distinct_ticket_count,
        v_min_ticket_number,
        v_max_ticket_number
    FROM public.bookings AS b
    JOIN public.payments AS p ON p.booking_id = b.id
    LEFT JOIN public.digital_tickets AS t ON t.booking_id = b.id
    WHERE b.status = 'confirmed'
      AND p.status = 'paid'
    GROUP BY b.id, b.quantity
    HAVING COUNT(t.id) <> b.quantity
        OR COUNT(DISTINCT t.ticket_number) <> b.quantity
        OR MIN(t.ticket_number) <> 1
        OR MAX(t.ticket_number) <> b.quantity
    ORDER BY b.id
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION USING
            MESSAGE = format(
                'Migration 009 aborted: booking %s expected %s tickets numbered 1..%s, found %s rows and %s distinct ticket numbers in range %s..%s.',
                v_booking_id,
                v_quantity,
                v_quantity,
                v_ticket_count,
                v_distinct_ticket_count,
                COALESCE(v_min_ticket_number::TEXT, '<none>'),
                COALESCE(v_max_ticket_number::TEXT, '<none>')
            ),
            HINT = 'The migration transaction must roll back; reconcile the ticket rows before retrying.';
    END IF;
END;
$migration$;
