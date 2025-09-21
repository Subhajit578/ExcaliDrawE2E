import {z} from "zod";

export const CreateUserSchema = z.object({
    email: z.string(),
    username: z.string().min(3).max(20),
    password: z.string()
})
export const SigninUserSchema = z.object({
    email: z.string().min(3).max(20),
    password: z.string()
})
export const CreateRoomSchema = z.object({
   slug : z.string().min(3).max(20)
})
