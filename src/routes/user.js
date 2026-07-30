import express from 'express';
import { checkUserExists, createUserProfile } from '../controllers/user.js';
import { optionalAuth } from '../middleware/authMiddleware.js';
import { userRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

router.get("/check", optionalAuth, userRateLimiter, checkUserExists);
router.post("/profile", optionalAuth, userRateLimiter, createUserProfile);

export default router;
