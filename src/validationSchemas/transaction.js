import { z } from 'zod';

export const transactionSchema = z.object({
  amount: z.number()
    .positive("Amount must be greater than zero")
    .max(1000000000, "Amount exceeds maximum limit"), 
    
  type: z.enum(["income", "expense"]),
  
  date: z.coerce.date()
    .max(new Date(), "Date cannot be in the future"), 
    
  category: z.string()
    .trim() 
    .min(1, "Category is required")
    .max(50, "Category name is too long"),
    
  description: z.string()
    .trim()
    .min(1, "Description is required")
    .max(500, "Description is too long"), 
});

export const updateTransactionSchema = transactionSchema.partial().omit({ 
  type: true, 
  date: true 
});
