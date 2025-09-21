
import { NextFunction,Request,Response } from "express";
import { JWT_SECRET } from "@repo/backend-common/config";
import jwt from "jsonwebtoken"
export function isLoggedIn(req:Request,res:Response,  next:NextFunction){
    const auth = req.headers["authorization"];
    const raw = Array.isArray(auth) ? auth[0] : auth || "";
    const token = raw.startsWith("Bearer ") ? raw.slice(7) : raw;
    if (!token) 
        return res.status(401).json({ message: "Login Again" });
    let decoded;
    try { 
        decoded = jwt.verify(token, JWT_SECRET) as any; 
        const userId = decoded.userId
        const username = decoded.username
        //@ts-ignore
        req.userId = userId
        //@ts-ignore
        req.username = username
        return next()
    }catch (err)
    { return res.status(401).json({ message: err }); }
}