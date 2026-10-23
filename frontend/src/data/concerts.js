export const concerts = [
  {
    id: "1",
    slug: "symphony-of-lights",
    title: "Symphony of Lights",
    artist: "The Aurora Orchestra",
    category: "Orchestra",
    city: "Jakarta",
    venue: "Jakarta International Expo",
    date: "2027-01-17",
    time: "19:00",
    price: 350000,
    accent: "violet",
    image: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1200&q=85",
    description: "Malam musik sinematik yang memadukan orkestra, tata cahaya, dan pengalaman panggung imersif."
  },
  {
    id: "2",
    slug: "neon-summer",
    title: "Neon Summer Festival",
    artist: "Multiple Artists",
    category: "Festival",
    city: "Jakarta",
    venue: "JIExpo Kemayoran",
    date: "2027-02-21",
    time: "16:00",
    price: 275000,
    accent: "blue",
    image: "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=1200&q=85",
    description: "Festival musik dengan energi tinggi, pertunjukan live, dan suasana penuh warna."
  },
  {
    id: "3",
    slug: "midnight-frequency",
    title: "Midnight Frequency",
    artist: "DJ Nova & Friends",
    category: "Electronic",
    city: "Bandung",
    venue: "Eldorado Dome",
    date: "2027-03-08",
    time: "20:00",
    price: 225000,
    accent: "pink",
    image: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1200&q=85",
    description: "Perjalanan musik elektronik dengan visual futuristik dan deretan DJ pilihan."
  },
  {
    id: "4",
    slug: "echoes-of-us",
    title: "Echoes of Us",
    artist: "The Sunday Project",
    category: "Pop",
    city: "Yogyakarta",
    venue: "Jogja Expo Center",
    date: "2027-03-22",
    time: "19:30",
    price: 180000,
    accent: "orange",
    image: "https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=1200&q=85",
    description: "Konser pop dengan lagu-lagu penuh cerita untuk dinikmati bersama teman."
  },
  {
    id: "5",
    slug: "rock-the-city",
    title: "Rock the City",
    artist: "Voltage & The Rebels",
    category: "Rock",
    city: "Surabaya",
    venue: "Grand City Convention Hall",
    date: "2027-04-11",
    time: "19:00",
    price: 300000,
    accent: "red",
    image: "https://images.unsplash.com/photo-1501612780327-45045538702b?auto=format&fit=crop&w=1200&q=85",
    description: "Pertunjukan rock dengan permainan gitar bertenaga dan atmosfer panggung yang intens."
  },
  {
    id: "6",
    slug: "acoustic-stories",
    title: "Acoustic Stories",
    artist: "Ruang Senja",
    category: "Acoustic",
    city: "Bogor",
    venue: "Bogor Creative Center",
    date: "2027-04-25",
    time: "18:30",
    price: 150000,
    accent: "green",
    image: "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=1200&q=85",
    description: "Sesi musik akustik yang intim, hangat, dan dekat dengan para penonton."
  }
];

export const formatPrice = (price) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(price);

export const formatDate = (date) =>
  new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(`${date}T12:00:00`));
