import express from 'express';
import { userLogin, userLogout, userSignup } from '../controllers/user.js';
const router = express.Router();


router.post("/register", userSignup);
router.post("/logout", userLogout);
router.post("/login", userLogin);

export default router;
