import express from 'express';
import { userLogin, userLogout, userSignup } from '../controllers/user.js';
const router = express.Router();
import { ACTIONS } from '../constants/permissions.js';
import { checkUserPermission } from '../middleware/checkUserPermission.js';
import { optionalAuth } from '../middleware/authMiddleware.js';
import {userRateLimiter} from "../middleware/rateLimiter.js";

router.post("/register", optionalAuth, userRateLimiter, checkUserPermission(ACTIONS.CREATE_ACCOUNT),userSignup);
router.post("/logout", userLogout);
router.post("/login",  userLogin);

export default router;
