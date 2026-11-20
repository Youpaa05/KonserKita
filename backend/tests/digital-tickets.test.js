import { test } from "node:test";
import assert from "node:assert/strict";
import { generateTicketCode, issueBookingTickets } from "../src/services/digitalTickets.js";

function createClient({ bookingStatus="confirmed", paymentStatus="paid", quantity=2, existing=[] }={}) {
  const tickets = [...existing];
  const calls = [];
  return {
    tickets,
    calls,
    async query(sql, values=[]) {
      const query=sql.trim().replace(/\s+/g," "); calls.push(query);
      if (query.startsWith("SELECT b.id::text")) return {rowCount:1,rows:[{id:"41",quantity,bookingStatus,paymentStatus}]};
      if (query.startsWith("INSERT INTO digital_tickets")) {
        const [bookingId,ticketNumber,ticketCode]=values;
        if (tickets.some(ticket=>ticket.ticketCode===ticketCode || (ticket.bookingId===bookingId && ticket.ticketNumber===ticketNumber))) return {rowCount:0,rows:[]};
        const ticket={bookingId,ticketNumber,ticketCode,status:"issued",issuedAt:"2026-11-19T00:00:00.000Z",usedAt:null};
        tickets.push(ticket);return {rowCount:1,rows:[{ticketCode,ticketNumber}]};
      }
      if (query.startsWith("SELECT ticket_code") && query.includes("ticket_number = $2")) {
        const found=tickets.find(ticket=>ticket.bookingId===values[0] && ticket.ticketNumber===values[1]);
        return {rowCount:found?1:0,rows:found?[{ticketCode:found.ticketCode,ticketNumber:found.ticketNumber}]:[]};
      }
      if (query.startsWith("SELECT ticket_code")) {
        const rows=tickets.filter(ticket=>ticket.bookingId===values[0]).sort((a,b)=>a.ticketNumber-b.ticketNumber);
        return {rowCount:rows.length,rows:rows.map(({ticketCode,ticketNumber,status,issuedAt,usedAt})=>({ticketCode,ticketNumber,status,issuedAt,usedAt}))};
      }
      throw new Error(`Query tidak dikenal: ${query}`);
    },
  };
}

test("kode tiket memakai token acak 256-bit tanpa data pribadi",()=>{
  const first=generateTicketCode();const second=generateTicketCode();
  assert.match(first,/^KK-TKT-[A-F0-9]{64}$/);
  assert.notEqual(first,second);
  assert.doesNotMatch(first,/@|customer|email|phone/i);
});

test("booking confirmed dan paid menerbitkan tiket satu per quantity",async()=>{
  const client=createClient();
  const tickets=await issueBookingTickets(client,"41",{createCode:(()=>{let i=0;return()=>`KK-TKT-${String(++i).padStart(64,"0")}`;})()});
  assert.equal(tickets.length,2);assert.deepEqual(tickets.map(ticket=>ticket.ticketNumber),[1,2]);
  assert.equal(new Set(tickets.map(ticket=>ticket.ticketCode)).size,2);
});

test("booking pending, failed, expired, atau cancelled tidak menerbitkan tiket",async()=>{
  for(const [bookingStatus,paymentStatus] of [["pending","pending"],["cancelled","failed"],["cancelled","expired"],["cancelled","paid"],["confirmed","failed"]]){
    const client=createClient({bookingStatus,paymentStatus});
    assert.deepEqual(await issueBookingTickets(client,"41"),[]);
    assert.equal(client.tickets.length,0);
    assert.equal(client.calls.some(query=>query.startsWith("INSERT INTO digital_tickets")),false);
  }
});

test("penerbitan berulang idempotent dan collision kode di-retry",async()=>{
  const collision="KK-TKT-"+"A".repeat(64);
  const client=createClient({existing:[{bookingId:"other",ticketNumber:1,ticketCode:collision,status:"issued"}]});
  let call=0;
  const createCode=()=>++call===1?collision:`KK-TKT-${String(call).padStart(64,"0")}`;
  const first=await issueBookingTickets(client,"41",{createCode});
  const second=await issueBookingTickets(client,"41",{createCode});
  assert.equal(call,3);assert.equal(first.length,2);assert.equal(second.length,2);
  assert.equal(client.tickets.filter(ticket=>ticket.bookingId==="41").length,2);
});
