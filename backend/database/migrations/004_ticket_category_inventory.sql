ALTER TABLE public.ticket_categories
    ADD COLUMN archived_at TIMESTAMPTZ;

CREATE INDEX ticket_categories_active_concert_price_idx
    ON public.ticket_categories (concert_id, price)
    WHERE archived_at IS NULL;

CREATE INDEX ticket_categories_archived_at_idx
    ON public.ticket_categories (archived_at);