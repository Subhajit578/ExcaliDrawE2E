import {WebSocket, WebSocketServer} from "ws";
import jwt from "jsonwebtoken";
import {JWT_SECRET} from '@repo/backend-common/config'
import { prismaClient} from "@repo/db-package/client"
const wss = new WebSocketServer({port : 8080})
interface User {
    socket: WebSocket,
    rooms : string[],
    userId: string
}
const users :User[] = []

/** attempts for a database call (and for the connection at startup) */
const DB_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * True for errors that mean "the connection is the problem", not "the query is
 * wrong". Only these are worth retrying - a constraint violation would fail
 * identically every time.
 */
function isConnectionError(err: unknown): boolean {
    const name = (err as { name?: string })?.name ?? "";
    return (
        name === "PrismaClientInitializationError" ||
        name === "PrismaClientRustPanicError"
    );
}

/**
 * Run a database call, retrying while the connection is at fault.
 *
 * Neon suspends its compute when idle, so the first query after a quiet spell
 * can fail while it wakes. Worse, a PrismaClientInitializationError leaves the
 * client unusable for the life of the process - every later write fails the
 * same way even once the database is reachable again. That is why the
 * connection is torn down and rebuilt between attempts rather than simply
 * trying the query again.
 */
async function withDb<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= DB_ATTEMPTS; attempt++) {
        try {
            return await operation();
        } catch (err) {
            lastError = err;
            if (!isConnectionError(err) || attempt === DB_ATTEMPTS) break;

            console.warn(
                `[WS] database unreachable (attempt ${attempt}/${DB_ATTEMPTS}), reconnecting...`
            );
            try { await prismaClient.$disconnect(); } catch { /* already down */ }
            await sleep(500 * attempt);
            try { await prismaClient.$connect(); } catch { /* the retry will report it */ }
        }
    }

    throw lastError;
}

/**
 * Wake the database at startup so the first person to draw is not the one who
 * discovers the connection is cold. Failing here is not fatal: the socket
 * server still relays live strokes, and writes retry on demand.
 */
async function connectDatabase() {
    for (let attempt = 1; attempt <= DB_ATTEMPTS; attempt++) {
        try {
            await prismaClient.$connect();
            console.log("[WS] database connected");
            return;
        } catch (err) {
            console.warn(
                `[WS] could not connect to the database (attempt ${attempt}/${DB_ATTEMPTS})`
            );
            await sleep(1000 * attempt);
        }
    }
    console.error("[WS] starting without a database connection; writes will retry on demand");
}

connectDatabase();
function checkUser(token : string ): string | null {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if(typeof decoded == "string"){
            return null;
        } if(!decoded || !decoded.userId) {
            return null;
        }
        return decoded.userId
        
      } catch (e) {
        console.error("[WS] jwt.verify failed:", e);
        return null;
      }
}
wss.on("connection" , function(socket,request){
    const url = request.url;
    if(!url){
        return;
    }
    const queryParams = new URLSearchParams(url.split('?')[1])
    const token =  queryParams.get('token')  || ""
    const userId = checkUser(token)
    if(userId== null){
        socket.close()
        return null
    } 
    users.push({
        userId,
        rooms: [],
        socket
    })
    socket.on("close", () => {
        const i = users.findIndex(u => u.socket === socket);
        if (i !== -1) users.splice(i, 1);
      });
    socket.on('message',async function message(data ){
      // one guard around the whole handler: a bad frame, a rejected query or a
      // sleeping database must not take the process down for everyone
      try {
        let parsedData
        if (typeof data !== "string") {
            parsedData = JSON.parse(data.toString());
          } else {
            parsedData = JSON.parse(data); // {type: "join-room", roomId: 1}
          }


        if(parsedData.type === "join_room"){
            const user = users.find(x => x.socket === socket)
            user?.rooms.push(parsedData.roomId);
            return;
        }

        if(parsedData.type === "leave_room"){
            const user = users.find(x => x.socket === socket)
            if(!user){
                return;
            }
            user.rooms = user?.rooms.filter( x => x !== parsedData.roomId)
            return;
        }

        if (parsedData.type === "stroke_start" || parsedData.type === "stroke_point") {
            const roomId = parsedData.roomId;
            users.forEach(u => {
              if (u.rooms.includes(roomId) && u.socket !== socket) {
                u.socket.send(JSON.stringify(parsedData));
              }
            });
            return;
        }

        if (parsedData.type === "clear_room") {
            const roomId = parsedData.roomId;
            await withDb(() => prismaClient.shape.deleteMany({
              where: { roomId: Number(roomId) },
            }));
            users.forEach((u) => {
              if (u.rooms.includes(roomId)) {
                u.socket.send(JSON.stringify({ type: "clear_room", roomId }));
              }
            });
            return;
        }

        if(parsedData.type === "shape"){
            const roomId = parsedData.roomId
            const shape = parsedData.shape;
            const id = parsedData.id ?? shape?.id;

            // the client names its own shapes now, so this is untrusted input
            if (typeof id !== "string" || id.length === 0 || id.length > 100) {
                socket.send(JSON.stringify({
                    type: "error",
                    message: "Shape is missing a valid id",
                    strokeId: parsedData.strokeId ?? null,
                }));
                return;
            }

            // upsert, not create: a resend of the same id is a no-op instead of a
            // unique-constraint error. `update` stays empty on purpose - editing a
            // shape belongs to a future update_shape message that carries its own
            // ownership check.
            const created = await withDb(() => prismaClient.shape.upsert({
                where: { id },
                create: {
                    id,
                    type : shape.type,
                    data: shape.data,
                    roomId: Number(roomId),
                    userId,
                },
                update: {},
            }))
            users.forEach(user => {
                if(user.rooms.includes(roomId)){
                    user.socket.send(JSON.stringify({
                        type:"shape",
                        shape: created,
                        // relayed back so receivers can drop the live preview of
                        // this stroke; without it the preview never clears
                        strokeId: parsedData.strokeId ?? null,
                        roomId
                    }))
                }
            })
            return;
        }
      } catch (err) {
        console.error("[WS] failed to handle message:", err);
        try {
          socket.send(JSON.stringify({
            type: "error",
            message: "Could not process that message",
          }));
        } catch {
          // socket already gone; nothing to report to
        }
      }
})
})