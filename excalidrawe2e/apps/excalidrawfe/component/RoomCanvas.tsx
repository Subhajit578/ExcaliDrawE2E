"use client"
import { initDraw } from "@/draw";
import { useRef, useEffect,useState } from "react";
import { Canvas } from "./Canvas";

export function RoomCanvas({roomId} : {roomId : string}) { 
    const [socket, setSocket] =  useState<WebSocket | null>(null);
    useEffect(() => {
        const ws = new WebSocket(`ws://localhost:8080/?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIwNzNmOWJhMS1jNTE2LTQzNDItOTMyZC1kNWI5YzRlMmRhNmIiLCJ1c2VybmFtZSI6IlN1Ymhhaml0NyIsImlhdCI6MTc1ODQyNDE1M30.yzAtuam_kf4mWEfXTKiM-xK8WP7mUYQjxIH1QHLUG-8`);        
        ws.onopen = () => {
            setSocket(ws);
            const data = JSON.stringify({
                type: "join_room",
                roomId
            });
            ws.send(data);
        }
    },[])
    if(!socket ){
        return <div>
            Connecting to Server 
        </div>
    }
    return <div>
        <Canvas roomId = {roomId} socket = {socket}/>   
    </div>
}