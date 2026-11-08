import WebSocket from "ws";
import fs from "node:fs";
const D = "/private/tmp/claude-501/-Users-subhajit-Projects-ExcaliDrawE2E/cd34a6c0-dbdb-4b4b-b10c-1fe19efd51a1/scratchpad/";
const TOKEN = fs.readFileSync(D+"bt.txt","utf8").trim();
const ROOM = String(JSON.parse(fs.readFileSync(D+"rm.json","utf8")).roomId);
const N = Number(process.argv[2] || 50);

const ws = new WebSocket(`ws://localhost:8080?token=${TOKEN}`);
await new Promise(r => ws.on("open", r));
ws.send(JSON.stringify({ type: "join_room", roomId: ROOM }));
await new Promise(r => setTimeout(r, 400));

// create N shapes, then time moving all of them as a group
const ids = [];
for (let i = 0; i < N; i++) {
  const id = crypto.randomUUID(); ids.push(id);
  ws.send(JSON.stringify({ type: "shape", id, roomId: ROOM,
    shape: { type: "rect", data: { x: i*7, y: 100, width: 20, height: 20, color: "ink" } } }));
}
await new Promise(r => setTimeout(r, 6000));
fs.writeFileSync(D+"bench_ids.json", JSON.stringify(ids));

// count the acks so we know when the server has finished all the writes
let acks = 0;
ws.on("message", (raw) => { const m = JSON.parse(raw); if (m.type === "update_shape") acks++; });

const t0 = performance.now();
for (let i = 0; i < N; i++) {
  ws.send(JSON.stringify({ type: "update_shape", id: ids[i], roomId: ROOM,
    data: { x: i*7 + 300, y: 400, width: 20, height: 20, color: "ink" } }));
}
while (acks < N && performance.now() - t0 < 60000) await new Promise(r => setTimeout(r, 20));
const ms = performance.now() - t0;
console.log(`BEFORE: moving ${N} shapes = ${N} update_shape messages`);
console.log(`  acks received : ${acks}/${N}`);
console.log(`  wall time     : ${ms.toFixed(0)} ms`);
console.log(`  per shape     : ${(ms/N).toFixed(1)} ms`);
ws.close();
