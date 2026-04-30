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
//fetch room details using slugs
app.get("/room/:slug", isLoggedIn, async(req , res) => {
    const room = await prismaClient.room.findUnique({
        where : { slug : req.params.slug}, 
        select : {id:true, slug: true, admin: true, createdAt: true}
    }); 
    if(!room ) {
        return res.status(404).send({err : "Error finding room"})
    } else {
        return res.send({room})
    }
})
app.get("/shapes/:roomId" , isLoggedIn, async (req, res) => {
    const roomId = Number(req.params.roomId)
    if(Number.isNaN(roomId)) {
        return res.status(404).send({message : "Invalid Room Id"})
    } else {
        try {
            const shapes = await prismaClient.shape.findMany({
                where : {roomId}, 
                orderBy: {id : "asc"}
            })
            res.send({shapes})
        } catch(err) {
            return res.status(411).send({err : "Error Fetching content"})
        }
    }
})
app.get("/rooms", isLoggedIn, async(req, res) => {
const userId = req.body.userId
try {
const rooms = await prismaClient.room.findMany({
    where : {adminId : userId},
    orderBy: {createdAt: "desc"}, 
    select : {id:true, slug: true, createdAt:true}
})
res.send({rooms})
} 
catch(err) {
    res.status(404).send({err : "Error finding user docs"})
}
})
app.listen(3001)





