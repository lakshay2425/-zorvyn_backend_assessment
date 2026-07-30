import * as z from "zod";

export const createUserProfileSchema = z.object({
    name: z.string().trim().min(1).optional(),
});
