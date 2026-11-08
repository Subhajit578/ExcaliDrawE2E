import {WebSocket, WebSocketServer} from "ws";
import jwt from "jsonwebtoken";
import {JWT_SECRET} from '@repo/backend-common/config'
import { prismaClient} from "@repo/db-package/client"
import { updateShapesBatch, deleteShapesBatch } from "./batchWrites"
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
function isPartOfRoom(socket : WebSocket, roomId: unknown) {
    if(typeof roomId !="string" || roomId.length == 0) return false;
    const user = users.find(x => x.socket === socket)
            if(!user){
                return false;
            }
            return user.rooms.includes(roomId);
}
function requireRoom(socket: WebSocket, roomId: unknown): boolean {
    if (isPartOfRoom(socket, roomId)) return true;
    socket.send(JSON.stringify({
        type: "error",
        message: "You have not joined that room",
    }));
    return false;
}
/**
 * Is this user the room's admin?
 *
 * roomId arrives as the room's numeric id in string form - the same value the
 * shape branch passes through Number() - so the lookup is by id, not slug.
 *
 * Fails closed. A database error is not caught here: withDb retries a cold
 * connection, and anything that survives that reaches the handler's outer
 * catch, which refuses the message. Returning something truthy on failure
 * would let a hiccup grant permission to wipe a board.
 */
/**
 * Shapes announced to the room but not yet written.
 *
 * Broadcasting before persisting means a client can act on a shape that has
 * no row yet - drag it, or erase it - and send an update or delete that would
 * find nothing and be refused. Edits wait on the entry here, so the ordering
 * the user sees is the ordering the database gets.
 *
 * Entries live for one write and are removed in a finally, so a failed write
 * cannot wedge later edits behind a promise that never settles.
 */
/**
 * Most shapes one batched message may carry.
 *
 * A ceiling on how much work a single message can ask for, so a malformed or
 * hostile client cannot make the server build an enormous statement. Well
 * above any real selection.
 */
const MAX_BATCH = 2000

const pendingCreates = new Map<string, Promise<unknown>>()

/** Wait for a shape's create to finish, if one is still in flight. */
async function awaitPendingCreate(id: unknown) {
    if (typeof id !== "string") return
    // a rejected create is still an answer: the row will not appear, and the
    // caller should go on to find nothing rather than hang
    await pendingCreates.get(id)?.catch(() => {})
}

async function isAdmin(roomId: unknown, userId: string): Promise<boolean> {
    if (typeof roomId !== "string" || roomId.length === 0) return false;
    const id = Number(roomId);
    if (!Number.isInteger(id)) return false;

    const room = await withDb(() =>
        prismaClient.room.findUnique({
            where: { id },
            select: { adminId: true },
        })
    );
    return room?.adminId === userId;
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
            if(!requireRoom(socket, roomId)) return;
            if (!(await isAdmin(roomId, userId, ))) {
                socket.send(JSON.stringify({
                    type: "error",
                    message: "Only the room's owner can clear the board",
                }));
                return;
            }
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
        // Many shapes in one message, for a gesture that touched a whole
        // selection: a group drag, a group resize, a multi-delete. One
        // message, one broadcast, one statement per chunk - instead of a
        // message, a broadcast and a round trip per shape.
        if (parsedData.type === "update_shapes" || parsedData.type === "delete_shapes") {
            const roomId = parsedData.roomId;
            if(!requireRoom(socket, roomId)) return;
            const deleting = parsedData.type === "delete_shapes";
            const items: unknown[] = Array.isArray(parsedData.updates)
                ? parsedData.updates
                : Array.isArray(parsedData.ids) ? parsedData.ids : [];

            if (items.length === 0) return;
            if (items.length > MAX_BATCH) {
                socket.send(JSON.stringify({
                    type: "error",
                    message: `A single change cannot cover more than ${MAX_BATCH} shapes`,
                }));
                return;
            }

            const validId = (v: unknown): v is string =>
                typeof v === "string" && v.length > 0 && v.length <= 100;

            if (deleting) {
                const ids = items.filter(validId);
                if (ids.length !== items.length) {
                    socket.send(JSON.stringify({ type: "error", message: "Shape is missing a valid id" }));
                    return;
                }
                for (const id of ids) await awaitPendingCreate(id);
                users.forEach(user => {
                    if(user.rooms.includes(roomId)){
                        user.socket.send(JSON.stringify({ type: "delete_shapes", ids, roomId }))
                    }
                })
                try {
                    await withDb(() => deleteShapesBatch(Number(roomId), ids))
                } catch (err) {
                    console.error("[WS] batch delete failed:", err)
                    socket.send(JSON.stringify({ type: "error", message: "Those shapes could not be deleted" }))
                }
                return;
            }

            const updates = items as { id?: unknown; data?: unknown }[];
            const clean = updates.filter(
                (u) => validId(u?.id) && typeof u?.data === "object" && u.data !== null && !Array.isArray(u.data)
            ) as { id: string; data: unknown }[];
            if (clean.length !== updates.length) {
                socket.send(JSON.stringify({ type: "error", message: "A shape update is missing its id or data" }));
                return;
            }

            for (const u of clean) await awaitPendingCreate(u.id);
            // broadcast first, for the same reason one shape does: the write
            // adds nothing the receivers need, only delay
            users.forEach(user => {
                if(user.rooms.includes(roomId)){
                    user.socket.send(JSON.stringify({ type: "update_shapes", updates: clean, roomId }))
                }
            })
            try {
                await withDb(() => updateShapesBatch(Number(roomId), clean))
            } catch (err) {
                console.error("[WS] batch update failed:", err)
                socket.send(JSON.stringify({ type: "error", message: "Those changes could not be saved" }))
            }
            return;
        }

        if(parsedData.type ==="update_shape") {
            const roomId = parsedData.roomId;
            if(!requireRoom(socket, roomId)) return;
            const data = parsedData.data;
            const id = parsedData.id;
            if (typeof id !== "string" || id.length === 0 || id.length > 100) {
                socket.send(JSON.stringify({ type: "error", message: "Shape is missing a valid id" }));
                return;
            }
            if (typeof data !== "object" || data === null || Array.isArray(data)) {
                socket.send(JSON.stringify({ type: "error", message: "Shape update is missing its data", id }));
                return;
            }
            // the create may still be in flight, now that shapes are announced
            // before they are written: editing one the instant it appears must
            // not race ahead of its own row
            await awaitPendingCreate(id)

            const updated = await withDb(() =>  prismaClient.shape.updateMany({
                // scoped to the room: membership of roomId alone must not let
                // someone edit a shape that lives on another board
                where: { id, roomId: Number(roomId) },
                data : { data}
            }))
            if (updated.count === 0) {
                // id included so the sender can revert its optimistic change:
                // without it the client cannot tell which shape was refused
                socket.send(JSON.stringify({ type: "error", message: "That shape no longer exists", id }));
                return;
            }
        
            users.forEach(user => {
                if(user.rooms.includes(roomId)){
                    user.socket.send(JSON.stringify({
                        type:"update_shape",
                        id, data, roomId
                    }))
                }
            })
            return;
        }
        if(parsedData.type ==="delete_shape") {
            const roomId = parsedData.roomId;
            if(!requireRoom(socket, roomId)) return;
            const id = parsedData.id;
            if (typeof id !== "string" || id.length === 0 || id.length > 100) {
                socket.send(JSON.stringify({ type: "error", message: "Shape is missing a valid id" }));
                return;
            }
            // same reason as update_shape: erasing a shape the moment it
            // appears must not reach the database before its own create does,
            // or the delete matches nothing and the shape comes back
            await awaitPendingCreate(id)

            const deleted = await withDb(() =>  prismaClient.shape.deleteMany({
                where: { id, roomId: Number(roomId) },
            }))
            // nothing matched - already erased, or not a shape in this room -
            // so there is nothing for anyone to remove
            if (deleted.count === 0) return;
            users.forEach(user => {
                if(user.rooms.includes(roomId)){
                    user.socket.send(JSON.stringify({
                        type:"delete_shape",
                        id, roomId
                    }))
                }
            })
            return;
        }
        if(parsedData.type === "shape"){
            const roomId = parsedData.roomId
            if(!requireRoom(socket, roomId)) return;
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

            // Broadcast first, persist after.
            //
            // The write used to come first, which meant everyone else waited a
            // database round trip - seconds, on a cold serverless Postgres -
            // before a finished shape appeared. Nothing in the message needs
            // the database to produce it: the client names its own shapes and
            // sends complete geometry, so the row adds no information, only
            // delay. Pencil strokes have always been relayed without touching
            // the database and that is exactly why they feel immediate.
            //
            // Safe to send unconfirmed because receivers dedupe by id and the
            // write below is an upsert, so a resend is a no-op. The cost is
            // the failure path: if the write loses, everyone has been told
            // about a shape that does not exist, so it has to be taken back.
            users.forEach(user => {
                if(user.rooms.includes(roomId)){
                    user.socket.send(JSON.stringify({
                        type:"shape",
                        shape: { id, type: shape.type, data: shape.data },
                        // relayed back so receivers can drop the live preview of
                        // this stroke; without it the preview never clears
                        strokeId: parsedData.strokeId ?? null,
                        roomId
                    }))
                }
            })

            // upsert, not create: a resend of the same id is a no-op instead of a
            // unique-constraint error. `update` stays empty on purpose - editing a
            // shape belongs to a future update_shape message that carries its own
            // ownership check.
            const write = withDb(() => prismaClient.shape.upsert({
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

            // Registered while in flight so an edit or delete of this shape,
            // which can now arrive before the row exists, waits for it rather
            // than matching nothing and being refused.
            pendingCreates.set(id, write)

            try {
                await write
            } catch (err) {
                // A write that reports failure has not necessarily failed.
                // P1001 is a lost connection, and the row may well have been
                // committed before the answer went missing - measured: three
                // creates reported P1001 and all three were in the table
                // afterwards. Retracting on the error alone would delete from
                // every client a shape the database still holds, and a reload
                // would bring it back from the dead.
                //
                // So ask before undoing anything. Only a shape confirmed
                // absent is taken back.
                console.error("[WS] shape create reported a failure:", err)
                let stored = null
                try {
                    stored = await withDb(() => prismaClient.shape.findUnique({ where: { id } }))
                } catch (checkErr) {
                    // cannot even ask: leave the shape standing rather than
                    // delete work on a guess. A stale client is recoverable by
                    // reloading; a wrongly deleted shape is not.
                    console.error("[WS] could not confirm shape, leaving it:", checkErr)
                }

                if (stored === null) {
                    users.forEach(user => {
                        if(user.rooms.includes(roomId)){
                            user.socket.send(JSON.stringify({ type: "delete_shape", id, roomId }))
                        }
                    })
                    socket.send(JSON.stringify({
                        type: "error",
                        message: "That shape could not be saved",
                        strokeId: parsedData.strokeId ?? null,
                    }))
                }
            } finally {
                pendingCreates.delete(id)
            }
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