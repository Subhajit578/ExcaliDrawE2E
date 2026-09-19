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

        console.log("message received")
        console.log(parsedData);

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
            await prismaClient.shape.deleteMany({
              where: { roomId: Number(roomId) },
            });
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
            const created = await prismaClient.shape.upsert({
                where: { id },
                create: {
                    id,
                    type : shape.type,
                    data: shape.data,
                    roomId: Number(roomId),
                    userId,
                },
                update: {},
            })
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