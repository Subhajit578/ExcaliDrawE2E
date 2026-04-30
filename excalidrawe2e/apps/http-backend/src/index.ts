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
        roomId : room.id, slug :room.slug
    })
} catch (err){
    return res.json({message:"room already exist"})
}
    
})
//fetch room details using slugs
app.get("/room/:slug", isLoggedIn, async(req , res) => {
    const room = await prismaClient.room.findUnique({
        where : { slug : req.params.slug}, 
        select : {id:true, slug: true, createdAt: true, admin:{select : {id: true , username :true}}}
})
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
    //@ts-ignore
const userId = req.userId
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
app.delete("/room/:id" , isLoggedIn, async(req, res) => {
    const id = Number(req.params.id)
    //@ts-ignore
    const userId = req.userId; 
    try {
    const room = await prismaClient.room.findUnique({where : {id}})
    if(!room) return res.status(404).send({message : "Not found "})
    else if(room.adminId !== userId) {
        return res.status(403).send({message : "not ur room"})
    } else {
        try {
            await prismaClient.shape.deleteMany({ where: { roomId: id } });
            await prismaClient.room.delete({ where: { id } });
        } catch (err) {
            return res.send({message : "Error deleting Message "})
        }
    }
    } catch (err) {
console.log(err, err)
res.status(500).send({error : err})
}
})
app.patch("/room/:id", isLoggedIn, async (req, res) => {
    const id = Number(req.params.id);            // ← convert
    if (Number.isNaN(id)) {                       // ← now this check actually works
      return res.status(400).send({ message: "Invalid id" });
    }
  
    // @ts-ignore
    const userId = req.userId;
    const slug = req.body.slug;
  
    if (!slug || typeof slug !== "string") {
      return res.status(400).send({ message: "Invalid Slug" });
    }
  
    const room = await prismaClient.room.findUnique({ where: { id } });
    if (!room) return res.status(404).send({ message: "Not found" });
    if (room.adminId !== userId) {
      return res.status(403).send({ message: "Not your room" });
    }
  
    try {
      const updated = await prismaClient.room.update({
        where: { id },
        data: { slug },
        select: { id: true, slug: true },
      });
      res.send(updated);
    } catch (err: any) {
      if (err.code === "P2002") {
        return res.status(409).send({ message: "Slug already taken" });
      }
      console.error(err);
      res.status(500).send({ message: "Failed to rename" });
    }
  });
app.listen(3001)





