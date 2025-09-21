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
        let parsedData
        if (typeof data !== "string") {
            parsedData = JSON.parse(data.toString());
          } else {
            parsedData = JSON.parse(data); // {type: "join-room", roomId: 1}
          }
        if(parsedData.type === "join_room"){
            const user = users.find(x => x.socket === socket)
            user?.rooms.push(parsedData.roomId);
        }
        if(parsedData.type === "leave_room"){
            const user = users.find(x => x.socket === socket)
            if(!user){
                return;
            }
            user.rooms = user?.rooms.filter( x => x !== parsedData.room)
        }
        console.log("message received")
        console.log(parsedData);
        if(parsedData.type === "chat"){
            const roomId = parsedData.roomId
            const message = parsedData.message;
            await prismaClient.chat.create({
                data: {
                    roomId: Number(roomId),
                    message,
                    userId
                }
            })
            users.forEach(user => {
                if(user.rooms.includes(roomId)){
                    user.socket.send(JSON.stringify({
                        type:"chat",
                        message : message,
                        roomId
                    }))
                }
            })
        }

})
})