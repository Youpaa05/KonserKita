import { pool } from "../../src/config/database.js";
import { expireStaleBookings } from "../../src/services/expireBookings.js";

export const config = {
  schedule: "* * * * *",
};

export default async function expireBookings() {
  const result = await expireStaleBookings({ pool });
  console.info("Expired booking cleanup completed:", result);
  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json" },
  });
}
