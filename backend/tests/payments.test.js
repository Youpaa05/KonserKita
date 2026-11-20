import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createPaymentRouter } from "../src/routes/payments.js";
import { generateSessionToken, hashSessionToken, SESSION_COOKIE_NAME } from "../src/utils/session.js";

async function harness({ status="pending", expired=false, expireOnStatusUpdate=false, issueFailure=false, ownerUserId=null, authenticatedUserId=null, authenticatedRole="customer", holdLock=false, expiresInMs=60000 }={}, run) {
 let paymentStatus=status, restored=0, bookingStatus=status === "paid" ? "confirmed" : "pending";
 let transactionSnapshot=null, issueCalls=0;
 const digitalTickets=[];
 const calls=[];
 const token=authenticatedUserId ? generateSessionToken() : null;
 const tokenHash=token ? hashSessionToken(token) : null;
 const row={id:"9",booking_id:"8",user_id:ownerUserId,ticket_category_id:"2",quantity:2,expires_at:expired?new Date(Date.now()-1000):new Date(Date.now()+expiresInMs)};
 function view(){return {bookingId:"8",bookingCode:"KK-0123456789ABCDEF",customerName:"Guest",userId:ownerUserId,quantity:2,unitPrice:100,totalPrice:200,bookingStatus,paymentStatus,amount:200,paymentMethod:"simulation",expiresAt:row.expires_at,paidAt:null,failedAt:null,expiredAt:null,ticketCategory:"Regular",concertSlug:"test",concertTitle:"Konser Test",eventDate:"2027-01-01",eventTime:"19:00"};}
 let unblockHeldLock = null;
 let lockTail = holdLock ? new Promise(resolve=>{unblockHeldLock=resolve;}) : Promise.resolve();
 function createClient() {
  let releaseLock = null;
  return {
   async query(sql,values=[]) {
    const q=sql.trim().replace(/\s+/g," ");calls.push(q);
    if(q === "BEGIN") {transactionSnapshot={paymentStatus,restored,bookingStatus,tickets:[...digitalTickets]};return {rowCount:null,rows:[]};}
    if(q === "COMMIT") {transactionSnapshot=null;releaseLock?.(); releaseLock=null; return {rowCount:null,rows:[]};}
    if(q === "ROLLBACK") {if(transactionSnapshot){paymentStatus=transactionSnapshot.paymentStatus;restored=transactionSnapshot.restored;bookingStatus=transactionSnapshot.bookingStatus;digitalTickets.splice(0,digitalTickets.length,...transactionSnapshot.tickets);transactionSnapshot=null;}releaseLock?.(); releaseLock=null; return {rowCount:null,rows:[]}; }
    if(q.startsWith("SELECT p.id")) {
     if(q.includes("FOR UPDATE")) {
      const previous=lockTail; let release;
      lockTail=new Promise(resolve=>{release=resolve;});
      await previous; releaseLock=release;
     }
     return {rowCount:1,rows:[{...row,status:paymentStatus}]};
    }
    if(q.startsWith("SELECT expires_at <= clock_timestamp()"))return {rowCount:1,rows:[{is_expired:Date.now() >= row.expires_at.getTime()}]};
    if(q.startsWith("UPDATE payments SET status='paid'")){if(expireOnStatusUpdate){row.expires_at=new Date(Date.now()-1);return {rowCount:0,rows:[]};}paymentStatus="paid";return {rowCount:1,rows:[{id:row.id}]};}
    if(q.startsWith("UPDATE payments SET status='failed'")){if(expireOnStatusUpdate)return {rowCount:0,rows:[]};paymentStatus="failed";restored++;return {rowCount:1,rows:[{id:row.id}]};}
    if(q.startsWith("UPDATE payments SET status='expired'")){if(q.includes("expires_at <= clock_timestamp()") && Date.now()<row.expires_at.getTime())return {rowCount:0,rows:[]};paymentStatus="expired";restored++;return {rowCount:1,rows:[{id:row.id}]};}
    if(q.startsWith("UPDATE bookings SET status='confirmed'")){bookingStatus="confirmed";return {rowCount:1,rows:[]};}
    if(q.startsWith("UPDATE bookings SET status='cancelled'")){bookingStatus="cancelled";return {rowCount:1,rows:[]};}
    if(q.startsWith("UPDATE ticket_categories"))return {rowCount:1,rows:[]};
    if(q.startsWith("SELECT b.id::text AS id"))return {rowCount:1,rows:[{id:"8",quantity:2,bookingStatus,paymentStatus}]};
    if(q.startsWith("SELECT ticket_code AS \"ticketCode\", ticket_number AS \"ticketNumber\"")){
     const rows=digitalTickets.filter(ticket=>ticket.bookingId===values[0]).sort((a,b)=>a.ticketNumber-b.ticketNumber);
     return {rowCount:rows.length,rows:rows.map(({ticketCode,ticketNumber})=>({ticketCode,ticketNumber}))};
    }
    if(q.startsWith("INSERT INTO digital_tickets")){
     if(issueFailure && digitalTickets.length>0)throw new Error("simulated ticket insert failure after first ticket");
     const [bookingId,ticketNumber,ticketCode]=values;digitalTickets.push({bookingId,ticketNumber,ticketCode,status:"issued",issuedAt:"2026-11-19T00:00:00.000Z",usedAt:null});
     return {rowCount:1,rows:[{ticketCode,ticketNumber}]};
    }
    if(q.startsWith("INSERT INTO user_notifications"))return {rowCount:1,rows:[]};
    if(q.startsWith("SELECT ticket_code AS \"ticketCode\", ticket_number AS \"ticketNumber\", status")){
     const rows=digitalTickets.filter(ticket=>ticket.bookingId===values[0]).sort((a,b)=>a.ticketNumber-b.ticketNumber);
     return {rowCount:rows.length,rows};
    }
    if(q.includes("WHERE b.id=$1"))return {rowCount:1,rows:[view()]};
    throw new Error(`SQL client tidak dikenal ${q}`);
   },
   release(){releaseLock?.();releaseLock=null;},
  };
 }
 const pool={async connect(){return createClient();},async query(sql,values=[]){calls.push(sql);if(sql.includes("FROM user_sessions")){const valid=values[0]===tokenHash;return {rowCount:valid?1:0,rows:valid?[{id:authenticatedUserId,name:"Customer Test",email:"customer@example.test",role:authenticatedRole}]:[]};}if(sql.includes("FROM digital_tickets")){const rows=digitalTickets.filter(ticket=>ticket.bookingId===values[0]).sort((a,b)=>a.ticketNumber-b.ticketNumber).map(ticket=>({ticketCode:ticket.ticketCode,ticketNumber:ticket.ticketNumber,ticketStatus:ticket.status,issuedAt:ticket.issuedAt,usedAt:ticket.usedAt}));return {rowCount:rows.length,rows};}if(sql.includes("b.user_id IS NULL"))return ownerUserId===null?{rowCount:1,rows:[view()]}:{rowCount:0,rows:[]};if(sql.includes("b.user_id=$2"))return values[1]===ownerUserId?{rowCount:1,rows:[view()]}:{rowCount:0,rows:[]};return {rowCount:1,rows:[view()]};}};
 const app=express();app.use(express.json());app.use("/api/payments",createPaymentRouter({pool,issueTickets:async(client,bookingId)=>{issueCalls++;return (await import("../src/services/digitalTickets.js")).issueBookingTickets(client,bookingId,{createCode:(()=>{let i=0;return()=>`KK-TKT-${String(++i).padStart(64,"0")}`;})()});}}));app.use((error,_req,res,_next)=>res.status(500).json({success:false,message:error.message}));
 const server=createServer(app);await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
 try{await run(`http://127.0.0.1:${server.address().port}`,{calls,cookie:token?`${SESSION_COOKIE_NAME}=${token}`:null,unblockHeldLock(){unblockHeldLock?.();unblockHeldLock=null;},expireNow(){row.expires_at=new Date(Date.now()-1);},get status(){return paymentStatus;},get restored(){return restored;},get bookingStatus(){return bookingStatus;},get issueCalls(){return issueCalls;},get ticketCount(){return digitalTickets.length;}});}finally{unblockHeldLock?.();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}

test("simulasi sukses mengonfirmasi booking dan menerbitkan jumlah tiket",async()=>harness({},async(base,db)=>{
 let r=await fetch(`${base}/api/payments/KK-0123456789ABCDEF/attempt`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({outcome:"success"})});assert.equal(r.status,200,JSON.stringify(await r.clone().json()));const body=await r.json();assert.equal(db.status,"paid");assert.equal(db.bookingStatus,"confirmed");assert.equal(body.data.tickets.length,2);assert.equal(db.issueCalls,1);assert.equal(db.ticketCount,2);
 await fetch(`${base}/api/payments/KK-0123456789ABCDEF/attempt`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({outcome:"failure"})});assert.equal(db.status,"paid");
}));

test("kegagalan penerbitan tiket me-rollback status pembayaran dan booking",async()=>harness({issueFailure:true},async(base,db)=>{
 const response=await fetch(`${base}/api/payments/KK-0123456789ABCDEF/attempt`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({outcome:"success"})});
 assert.equal(response.status,500);assert.equal(db.status,"pending");assert.equal(db.bookingStatus,"pending");assert.equal(db.ticketCount,0);assert.ok(db.calls.includes("ROLLBACK"));assert.ok(!db.calls.includes("COMMIT"));
}));

test("simulasi gagal membatalkan booking dan mengembalikan kuota satu kali",async()=>harness({},async(base,db)=>{
 for(let i=0;i<2;i++) await fetch(`${base}/api/payments/KK-0123456789ABCDEF/attempt`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({outcome:"failure"})});
 assert.equal(db.status,"failed");assert.equal(db.bookingStatus,"cancelled");assert.equal(db.restored,1);
}));

test("expiry database-side menandai expired dan mengembalikan kuota sekali",async()=>harness({expired:true},async(base,db)=>{
 const r=await fetch(`${base}/api/payments/KK-0123456789ABCDEF/attempt`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({outcome:"success"})});assert.equal(r.status,200);assert.equal(db.status,"expired");assert.equal(db.bookingStatus,"cancelled");assert.equal(db.restored,1);
}));

test("GET payment memproses expiry dan mengembalikan kuota satu kali",async()=>harness({expired:true},async(base,db)=>{
 const response=await fetch(`${base}/api/payments/KK-0123456789ABCDEF`);assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.data.paymentStatus,"expired");assert.equal(body.data.bookingStatus,"cancelled");
 assert.equal(db.restored,1);
}));

test("guest dapat memuat ulang tiket digital melalui GET payment setelah pembayaran berhasil",async()=>harness({},async(base)=>{
 const attempt=await fetch(`${base}/api/payments/KK-0123456789ABCDEF/attempt`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({outcome:"success"})});
 assert.equal(attempt.status,200);
 const response=await fetch(`${base}/api/payments/KK-0123456789ABCDEF`);
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.data.tickets.length,2);
 assert.match(body.data.tickets[0].ticketCode,/^KK-TKT-[A-F0-9]{64}$/);
}));

test("attempt menolak payload status bebas dan format kode invalid",async()=>harness({},async(base)=>{
 let r=await fetch(`${base}/api/payments/KK-0123456789ABCDEF/attempt`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:"paid"})});assert.equal(r.status,400);
 r=await fetch(`${base}/api/payments/BAD/attempt`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({outcome:"success"})});assert.equal(r.status,400);
}));

test("guest tidak dapat membaca atau mengubah payment booking milik customer",async()=>harness({ownerUserId:"customer-1"},async(base,db)=>{
 let response=await fetch(`${base}/api/payments/KK-0123456789ABCDEF`);
 assert.equal(response.status,404);
 response=await fetch(`${base}/api/payments/KK-0123456789ABCDEF/attempt`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({outcome:"failure"})});
 assert.equal(response.status,404);
 assert.equal(db.status,"pending");
 assert.equal(db.restored,0);
}));

test("customer pemilik dapat membaca dan membayar booking sendiri",async()=>harness({ownerUserId:"customer-1",authenticatedUserId:"customer-1"},async(base,db)=>{
 const headers={Cookie:db.cookie,"Content-Type":"application/json"};
 const read=await fetch(`${base}/api/payments/KK-0123456789ABCDEF`,{headers});
 assert.equal(read.status,200);
 const body=await read.json();
 assert.equal(body.data.paymentStatus,"pending");
 assert.equal(JSON.stringify(body).includes("customer@example.test"),false);
 const paid=await fetch(`${base}/api/payments/KK-0123456789ABCDEF/attempt`,{method:"POST",headers,body:JSON.stringify({outcome:"success"})});
 assert.equal(paid.status,200);assert.equal(db.status,"paid");assert.equal(db.bookingStatus,"confirmed");assert.equal(db.restored,0);
 assert.equal(db.calls.filter((call)=>call.startsWith("INSERT INTO user_notifications")).length,2);
}));

test("customer lain tidak dapat membaca atau membayar booking",async()=>harness({ownerUserId:"customer-1",authenticatedUserId:"customer-2"},async(base,db)=>{
 const headers={Cookie:db.cookie,"Content-Type":"application/json"};
 const read=await fetch(`${base}/api/payments/KK-0123456789ABCDEF`,{headers});assert.equal(read.status,404);
 const attempt=await fetch(`${base}/api/payments/KK-0123456789ABCDEF/attempt`,{method:"POST",headers,body:JSON.stringify({outcome:"failure"})});assert.equal(attempt.status,404);
 assert.equal(db.status,"pending");assert.equal(db.bookingStatus,"pending");assert.equal(db.restored,0);
}));

test("admin tidak dapat memakai endpoint payment guest/customer",async()=>harness({ownerUserId:null,authenticatedUserId:"admin-1",authenticatedRole:"admin"},async(base,db)=>{
 const response=await fetch(`${base}/api/payments/KK-0123456789ABCDEF`,{headers:{Cookie:db.cookie}});
 assert.equal(response.status,403);assert.equal(db.status,"pending");
}));

test("dua attempt bersamaan hanya memulihkan kuota satu kali",async()=>harness({},async(base,db)=>{
 const attempt=()=>fetch(`${base}/api/payments/KK-0123456789ABCDEF/attempt`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({outcome:"failure"})});
 const responses=await Promise.all([attempt(),attempt()]);
 assert.deepEqual(responses.map(response=>response.status),[200,200]);
 assert.equal(db.status,"failed");
 assert.equal(db.bookingStatus,"cancelled");
 assert.equal(db.restored,1);
 assert.equal(db.calls.filter(call=>call.includes("FOR UPDATE")).length,2);
}));

test("attempt yang baru memperoleh row lock setelah expiry ditolak dan refund sekali",async()=>harness({holdLock:true,expiresInMs:20},async(base,db)=>{
 const pending=fetch(`${base}/api/payments/KK-0123456789ABCDEF/attempt`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({outcome:"success"})});
 await new Promise(resolve=>setTimeout(resolve,40));
 db.expireNow();
 db.unblockHeldLock();
 const response=await pending;
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.data.paymentStatus,"expired");
 assert.equal(body.data.bookingStatus,"cancelled");
 assert.equal(db.status,"expired");assert.equal(db.bookingStatus,"cancelled");assert.equal(db.restored,1);
}));

test("expiry yang melewati deadline tepat sebelum transisi paid ditolak",async()=>harness({expireOnStatusUpdate:true},async(base,db)=>{
 const response=await fetch(`${base}/api/payments/KK-0123456789ABCDEF/attempt`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({outcome:"success"})});
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.data.paymentStatus,"expired");assert.equal(body.data.bookingStatus,"cancelled");
 assert.equal(db.status,"expired");assert.equal(db.bookingStatus,"cancelled");assert.equal(db.restored,1);
}));
