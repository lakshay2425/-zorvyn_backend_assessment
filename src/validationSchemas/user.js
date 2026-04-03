import * as z from "zod";

export const loginSchema = z.object({
    email: z.email()
        .trim()
        .transform(val => ({
            original: val,
            lowercase: val.toLowerCase()
        })),
    password: z.string()
        .trim()
        .min(6),
});

export const signupSchema = z.object({
    name: z.string().min(6, "Name must be at least 6 characters long"),
    email: z.email()
        .trim()
        .transform(val => ({
            original: val,
            lowercase: val.toLowerCase()
        })),
    username: z.string().min(8, "Username must be at least 8 characters long"),
    password: z.string().min(6, "Password must be at least 6 characters long"),
    isActive: z.boolean().default(true),
    role: z.enum(["viewer", "analyst", "admin"]).default("viewer"),
});
