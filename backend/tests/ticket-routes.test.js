import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createAdminTicketRouter } from "../src/routes/adminTickets.js";
import { createCustomerTicketRouter } from "../src/routes/customerTickets.js";
import { generateSessionToken, hashSessionToken, SESSION_COOKIE_NAME } from "../src/utils/session.js";

const validCode=`KK-TKT-${"C".repeat(64)}`;

async function adminHarness({role="admin",authenticated=true,known=true,failUpdate=false,status="issued",bookingStatus="confirmed",paymentStatus="paid",concertCancelled=false}={},run){
 const token=authenticated?generateSessionToken():null;const tokenHash=token?hashSessionToken(token):null;const calls=[];
 let ticketStatus=status,usedBy=null,usedAt=null,updates=0,snapshot=null,lockTail=Promise.resolve();
 const ticket={id:"ticket-1",ticketCode:validCode,ticketNumber:1,ticketStatus,bookingCode:"KK-0123456789ABCDEF",ownerName:"Customer Test",bookingStatus,paymentStatus,concertCancelledAt:concertCancelled?new Date("2026-01-01T00:00:00Z"):null,ticketCategory:"Festival",concertTitle:"Konser Tes",venue:"Gedung Tes",city:"Jakarta",eventDate:"2027-01-01",eventTime:"19:00"};
 const pool={async query(sql,values=[]){if(sql.includes("FROM user_sessions")){const ok=authenticated&&values[0]===tokenHash;return {rowCount:ok?1:0,rows:ok?[{id:"17",role}]:[]};}throw new Error(`Pool query tidak dikenal: ${sql}`);},async connect(){let releaseLock=null;return {async query(sql,values=[]){const q=sql.trim().replace(/\s+/g," ");calls.push(q);if(q==="BEGIN"){snapshot={ticketStatus,usedBy,usedAt,updates};return {rows:[]};}if(q==="COMMIT"){snapshot=null;releaseLock?.();releaseLock=null;return {rows:[]};}if(q==="ROLLBACK"){if(snapshot){ticketStatus=snapshot.ticketStatus;usedBy=snapshot.usedBy;usedAt=snapshot.usedAt;updates=snapshot.updates;snapshot=null;}releaseLock?.();releaseLock=null;return {rows:[]};}if(q.includes("FOR UPDATE OF t,b,p")){const prev=lockTail;let release;lockTail=new Promise(resolve=>{release=resolve;});await prev;releaseLock=release;return known&&values[0]===validCode?{rowCount:1,rows:[{...ticket,ticketStatus,usedBy,usedAt}]}:{rowCount:0,rows:[]};}if(q.startsWith("UPDATE digital_tickets")){if(failUpdate)throw new Error("simulated update failure");if(ticketStatus!=="issued")return {rowCount:0,rows:[]};ticketStatus="used";usedBy=values[1];usedAt="2026-11-19T12:00:00.000Z";updates++;return {rowCount:1,rows:[{usedAt}]};}throw new Error(`Query admin tidak dikenal: ${q}`);},release(){releaseLock?.();releaseLock=null;}};}};
 const app=express();app.use(express.json());app.use("/api/admin/tickets",createAdminTicketRouter({pool}));app.use((error,_req,res,_next)=>res.status(500).json({success:false,message:"internal"}));
 const server=createServer(app);await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
 try{await run(`http://127.0.0.1:${server.address().port}`,{calls,cookie:token?`${SESSION_COOKIE_NAME}=${token}`:null,get ticketStatus(){return ticketStatus;},get usedBy(){return usedBy;},get updates(){return updates;}});}finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}

async function customerHarness({userId="customer-1",ownerId="customer-1",authenticated=true,role="customer"}={},run){
 const token=authenticated?generateSessionToken():null;const tokenHash=token?hashSessionToken(token):null;const ticket={ticketCode:validCode,ticketNumber:1,ticketStatus:"issued",issuedAt:"2026-11-19T00:00:00.000Z",usedAt:null,bookingCode:"KK-0123456789ABCDEF",ownerName:"Customer Test",ticketCategory:"Festival",concertTitle:"Konser Tes",concertSlug:"konser-tes",venue:"Gedung Tes",city:"Jakarta",eventDate:"2027-01-01",eventTime:"19:00"};
 const pool={async query(sql,values=[]){if(sql.includes("FROM user_sessions")){const ok=authenticated&&values[0]===tokenHash;return {rowCount:ok?1:0,rows:ok?[{id:userId,role}]:[]};}if(sql.includes("SELECT b.id::text AS id FROM bookings"))return {rowCount:0,rows:[]};if(sql.includes("t.ticket_code=$2"))return values[0]===ownerId&&values[1]===validCode?{rowCount:1,rows:[ticket]}:{rowCount:0,rows:[]};if(sql.includes("WHERE b.user_id=$1 AND b.status='confirmed'"))return userId===ownerId?{rowCount:1,rows:[ticket]}:{rowCount:0,rows:[]};throw new Error(`Customer ticket query tidak dikenal ${sql}`);}};
 const app=express();app.use("/api/customer/tickets",createCustomerTicketRouter({pool}));
 const server=createServer(app);await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
 try{await run(`http://127.0.0.1:${server.address().port}`,token?`${SESSION_COOKIE_NAME}=${token}`:null);}finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}

test("admin memvalidasi tiket eligible dan menandainya used",async()=>adminHarness({},async(base,db)=>{
 const response=await fetch(`${base}/api/admin/tickets/validate`,{method:"POST",headers:{Cookie:db.cookie,"Content-Type":"application/json"},body:JSON.stringify({ticketCode:validCode})});
 assert.equal(response.status,200);const body=await response.json();assert.equal(body.data.valid,true);assert.equal(body.data.ticket.ticketStatus,"used");assert.equal(db.ticketStatus,"used");assert.equal(db.usedBy,"17");assert.equal(db.updates,1);assert.ok(db.calls.some(call=>call.includes("FOR UPDATE OF t,b,p")));
}));

test("kode tiket invalid ditolak",async()=>adminHarness({},async(base,db)=>{
 let response=await fetch(`${base}/api/admin/tickets/validate`,{method:"POST",headers:{Cookie:db.cookie,"Content-Type":"application/json"},body:JSON.stringify({ticketCode:"bad"})});assert.equal(response.status,400);
}));

test("tiket konser yang dibatalkan ditolak dan tidak ditandai used",async()=>adminHarness({concertCancelled:true},async(base,db)=>{
 const response=await fetch(`${base}/api/admin/tickets/validate`,{method:"POST",headers:{Cookie:db.cookie,"Content-Type":"application/json"},body:JSON.stringify({ticketCode:validCode})});assert.equal(response.status,409);assert.equal(db.ticketStatus,"issued");assert.equal(db.updates,0);assert.ok(db.calls.includes("ROLLBACK"));
}));

test("admin menolak penggunaan ulang tiket",async()=>adminHarness({status:"used"},async(base,db)=>{
 const response=await fetch(`${base}/api/admin/tickets/validate`,{method:"POST",headers:{Cookie:db.cookie,"Content-Type":"application/json"},body:JSON.stringify({ticketCode:validCode})});assert.equal(response.status,409);assert.equal(db.updates,0);
}));

test("validasi menolak tiket jika payment atau booking tidak eligible",async()=>{
 for(const options of [{paymentStatus:"failed"},{paymentStatus:"pending"},{bookingStatus:"cancelled"},{bookingStatus:"pending"}]){
  await adminHarness(options,async(base,db)=>{const response=await fetch(`${base}/api/admin/tickets/validate`,{method:"POST",headers:{Cookie:db.cookie,"Content-Type":"application/json"},body:JSON.stringify({ticketCode:validCode})});assert.equal(response.status,409);assert.equal(db.ticketStatus,"issued");assert.equal(db.updates,0);});
 }
});

test("tiket tidak dikenal menghasilkan 404",async()=>adminHarness({known:false},async(base,db)=>{
 const response=await fetch(`${base}/api/admin/tickets/validate`,{method:"POST",headers:{Cookie:db.cookie,"Content-Type":"application/json"},body:JSON.stringify({ticketCode:validCode})});assert.equal(response.status,404);
}));

test("admin validation menolak tanpa sesi dan role customer",async()=>{
 await adminHarness({authenticated:false},async(base)=>{const r=await fetch(`${base}/api/admin/tickets/validate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticketCode:validCode})});assert.equal(r.status,401);});
 await adminHarness({role:"customer"},async(base,db)=>{const r=await fetch(`${base}/api/admin/tickets/validate`,{method:"POST",headers:{Cookie:db.cookie,"Content-Type":"application/json"},body:JSON.stringify({ticketCode:validCode})});assert.equal(r.status,403);});
});

test("dua scan bersamaan hanya menggunakan tiket satu kali",async()=>adminHarness({},async(base,db)=>{
 const scan=()=>fetch(`${base}/api/admin/tickets/validate`,{method:"POST",headers:{Cookie:db.cookie,"Content-Type":"application/json"},body:JSON.stringify({ticketCode:validCode})});
 const responses=await Promise.all([scan(),scan()]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(db.ticketStatus,"used");assert.equal(db.updates,1);
}));

test("kegagalan update validasi melakukan rollback",async()=>adminHarness({failUpdate:true},async(base,db)=>{
 const response=await fetch(`${base}/api/admin/tickets/validate`,{method:"POST",headers:{Cookie:db.cookie,"Content-Type":"application/json"},body:JSON.stringify({ticketCode:validCode})});assert.equal(response.status,500);assert.equal(db.ticketStatus,"issued");assert.equal(db.updates,0);assert.ok(db.calls.includes("ROLLBACK"));assert.ok(!db.calls.includes("COMMIT"));
}));

test("customer hanya dapat melihat tiket miliknya; guest dan customer lain ditolak",async()=>{
 await customerHarness({},async(base,cookie)=>{let r=await fetch(`${base}/api/customer/tickets/${validCode}`,{headers:{Cookie:cookie}});assert.equal(r.status,200);r=await fetch(`${base}/api/customer/tickets`,{headers:{Cookie:cookie}});assert.equal(r.status,200);const body=await r.json();assert.equal(body.data.tickets.length,1);});
 await customerHarness({userId:"customer-2",ownerId:"customer-1"},async(base,cookie)=>{const r=await fetch(`${base}/api/customer/tickets/${validCode}`,{headers:{Cookie:cookie}});assert.equal(r.status,404);});
 await customerHarness({authenticated:false},async(base)=>{const r=await fetch(`${base}/api/customer/tickets`);assert.equal(r.status,401);});
});

test("GET daftar tiket hanya membaca dan tidak menerbitkan tiket",async()=>{
 const token=generateSessionToken();const calls=[];
 const pool={async query(sql,values=[]){calls.push(sql.trim().replace(/\s+/g," "));if(sql.includes("FROM user_sessions"))return {rowCount:1,rows:[{id:"customer-1",role:"customer"}]};assert.ok(sql.includes("FROM digital_tickets"));return {rowCount:0,rows:[]};},async connect(){throw new Error("GET daftar tiket tidak boleh membuka transaksi tulis");}};
 const app=express();app.use("/api/customer/tickets",createCustomerTicketRouter({pool}));
 const server=createServer(app);await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
 try{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/customer/tickets`,{headers:{Cookie:`${SESSION_COOKIE_NAME}=${token}`}});assert.equal(response.status,200);const body=await response.json();assert.deepEqual(body.data.tickets,[]);assert.equal(calls.length,2);assert.ok(calls[1].includes("WHERE b.user_id=$1"));}finally{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
