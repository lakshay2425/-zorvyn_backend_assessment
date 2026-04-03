import express from 'express';
import { getAnalytics } from '../controllers/analytics.js';
import { ACTIONS } from '../constants/permissions.js';
import { checkUserPermission } from '../middleware/checkUserPermission.js';
const router = express.Router();

router.get("/", checkUserPermission(ACTIONS.VIEW_DASHBOARD), getAnalytics);

export default router;
