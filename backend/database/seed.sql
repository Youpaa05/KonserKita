BEGIN;

INSERT INTO concerts (
    slug, title, artist, category, city, venue,
    event_date, event_time, accent, image_url, description
)
VALUES
(
    'symphony-of-lights',
    'Symphony of Lights',
    'The Aurora Orchestra',
    'Orchestra',
    'Jakarta',
    'Jakarta International Expo',
    DATE '2027-01-17',
    TIME '19:00',
    'violet',
    'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1200&q=85',
    'Malam musik sinematik yang memadukan orkestra, tata cahaya, dan pengalaman panggung imersif.'
),
(
    'neon-summer',
    'Neon Summer Festival',
    'Multiple Artists',
    'Festival',
    'Jakarta',
    'JIExpo Kemayoran',
    DATE '2027-02-21',
    TIME '16:00',
    'blue',
    'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=1200&q=85',
    'Festival musik dengan energi tinggi, pertunjukan live, dan suasana penuh warna.'
),
(
    'midnight-frequency',
    'Midnight Frequency',
    'DJ Nova & Friends',
    'Electronic',
    'Bandung',
    'Eldorado Dome',
    DATE '2027-03-08',
    TIME '20:00',
    'pink',
    'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1200&q=85',
    'Perjalanan musik elektronik dengan visual futuristik dan deretan DJ pilihan.'
),
(
    'echoes-of-us',
    'Echoes of Us',
    'The Sunday Project',
    'Pop',
    'Yogyakarta',
    'Jogja Expo Center',
    DATE '2027-03-22',
    TIME '19:30',
    'orange',
    'https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=1200&q=85',
    'Konser pop dengan lagu-lagu penuh cerita untuk dinikmati bersama teman.'
),
(
    'rock-the-city',
    'Rock the City',
    'Voltage & The Rebels',
    'Rock',
    'Surabaya',
    'Grand City Convention Hall',
    DATE '2027-04-11',
    TIME '19:00',
    'red',
    'https://images.unsplash.com/photo-1501612780327-45045538702b?auto=format&fit=crop&w=1200&q=85',
    'Pertunjukan rock dengan permainan gitar bertenaga dan atmosfer panggung yang intens.'
),
(
    'acoustic-stories',
    'Acoustic Stories',
    'Ruang Senja',
    'Acoustic',
    'Bogor',
    'Bogor Creative Center',
    DATE '2027-04-25',
    TIME '18:30',
    'green',
    'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=1200&q=85',
    'Sesi musik akustik yang intim, hangat, dan dekat dengan para penonton.'
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO ticket_categories (concert_id, name, price, quota)
SELECT c.id, v.name, v.price, v.quota
FROM (
    VALUES
        ('symphony-of-lights', 'General', 350000::NUMERIC, 500),
        ('symphony-of-lights', 'VIP',     525000::NUMERIC, 100),
        ('symphony-of-lights', 'VVIP',    700000::NUMERIC,  30),

        ('neon-summer', 'General', 275000::NUMERIC, 1000),
        ('neon-summer', 'VIP',     412500::NUMERIC,  200),
        ('neon-summer', 'VVIP',    550000::NUMERIC,   50),

        ('midnight-frequency', 'General', 225000::NUMERIC, 600),
        ('midnight-frequency', 'VIP',     337500::NUMERIC, 100),
        ('midnight-frequency', 'VVIP',    450000::NUMERIC,  25),

        ('echoes-of-us', 'General', 180000::NUMERIC, 500),
        ('echoes-of-us', 'VIP',     270000::NUMERIC,  80),
        ('echoes-of-us', 'VVIP',    360000::NUMERIC,  20),

        ('rock-the-city', 'General', 300000::NUMERIC, 700),
        ('rock-the-city', 'VIP',     450000::NUMERIC, 120),
        ('rock-the-city', 'VVIP',    600000::NUMERIC,  30),

        ('acoustic-stories', 'General', 150000::NUMERIC, 300),
        ('acoustic-stories', 'VIP',     225000::NUMERIC,  50),
        ('acoustic-stories', 'VVIP',    300000::NUMERIC,  15)
) AS v(slug, name, price, quota)
JOIN concerts c ON c.slug = v.slug
ON CONFLICT (concert_id, name) DO NOTHING;

COMMIT;