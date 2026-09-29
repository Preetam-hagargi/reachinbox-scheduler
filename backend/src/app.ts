import express from 'express';
import { emailSearchRouter } from './modules/emails/email-search-route.js';
import { slackRouter } from './modules/slack/slack-routes.js';
import cors from 'cors';
import { config } from './config/env.js';
import { attachOptionalAuth, authRouter } from './modules/auth/auth-routes.js';
import { emailManagementRouter } from './modules/emails/email-management-routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard-route.js';
import { bullBoardRouter } from './modules/dashboard/bull-board-route.js';

export const app = express();

app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(attachOptionalAuth);
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.use('/auth', authRouter);
app.use('/admin/queues', bullBoardRouter);

app.use('/api/dashboard', dashboardRouter);
app.use('/emails', emailManagementRouter);
app.use('/emails', emailSearchRouter);
app.use('/slack', slackRouter);
