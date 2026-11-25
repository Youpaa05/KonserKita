export function getConcertLineup(concert) {
  const providedLineup = Array.isArray(concert?.lineup)
    ? concert.lineup.filter((performer) => typeof performer === "string" && performer.trim())
    : [];

  if (providedLineup.length > 0) return providedLineup.map((performer) => performer.trim());

  return typeof concert?.artist === "string" && concert.artist.trim()
    ? [concert.artist.trim()]
    : [];
}
