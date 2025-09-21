import express from "express";
import jwt from "jsonwebtoken";
import {isLoggedIn} from "./middleware"
import {JWT_SECRET} from '@repo/backend-common/config'
import {CreateUserSchema,SigninUserSchema,CreateRoomSchema} from "@repo/common/types";
import { prismaClient} from "@repo/db-package/client"
import cors from "cors"
import bcrypt from "bcrypt"
const app = express()
app.use(express.json())
app.use(cors())

//done 
app.post("/signup", async (req,res) => {
    const email = req.body.email
    const password = req.body.password
    const username = req.body.username
    const data = CreateUserSchema.safeParse(req.body)
    if(!data.success) {
        return res.json({
            message : "Incorrect Inputs"
        })
    } else {
        try {
        const hashedPassword = await bcrypt.hash(password, 10)
        await prismaClient.user.create({
            data: {
                username: username,
                email :  email,
                password : hashedPassword,
                photo : ""
            },
        })
        res.status(200).send({message:"User created "})
    } catch (err){
        res.status(400).send({message: "Error creating user"})
    }
    }
}) 
// done 
app.post("/signin", async (req,res) => {
    const email = req.body.email
    const password = req.body.password
    const safeData = SigninUserSchema.safeParse(req.body)
    if(safeData.success ){
        const user = await prismaClient.user.findFirst({
            where : {email},
            select: { username: true, id: true, password: true }
    })
    if(!user){
        return res.status(404).send({"message":"User not found"})
    } else {
        const passwordMatch = await bcrypt.compare(password,user.password)
        if(passwordMatch){
            //@ts-ignore
            const token = jwt.sign({userId:user.id,username : user.username},JWT_SECRET) 
            return res.status(200).send({token :token})
        } else {
            return res.status(401).send({message:  "Invalid credentials"})
        }
    }
    } else {
       return  res.status(422).send({message:"Invalid input format "})
    }
})
app.post("/room", isLoggedIn ,async (req,res) => {
    const parsedData = CreateRoomSchema.safeParse(req.body);
    if(!parsedData.success){
        return res.json({
            message:"Incorrect Inputs"
        })
    }
    const slug = req.body.slug
    //@ts-ignore
    const userId = req.userId;
    try{
    const room = await prismaClient.room.create({
        data: {
            slug:slug,
            adminId:userId
        }
    })
    res.send({
        roomId : room.id
    })
} catch (err){
    return res.json({message:"room already exist"})
}
    
})
app.get("/chats/:roomId", async (req,res) => {
    const roomId =  Number(req.params.roomId);
    const messages = await prismaClient.chat.findMany({
        where : {
            roomId : roomId
        },
        orderBy : {
            id: "desc"
        },
        take : 50
    })
    res.send({messages : messages})
})
app.listen(3001)





