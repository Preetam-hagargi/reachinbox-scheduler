import { EmailStatus } from '@prisma/client';
import { DelayedError, type Job } from 'bullmq';
import { config } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { indexEmailJobByIdSafely } from '../integrations/elasticsearch/email-indexing.js';
import { SlackHourlyLimitNotifier } from '../integrations/slack/hourly-limit-notifier.js';
import { sendEtherealEmail, toSafeSmtpFailureReason } from '../integrations/ethereal/smtp.js';
import type { EtherealEmailResult } from '../integrations/ethereal/smtp.js';
import type { EmailJobPayload, EmailJobProcessingResult } from '../queue/types.js';
import { SenderSendGate } from './sender-send-gate.js';

export async function processEmailJob(
  job: Job<EmailJobPayload>,
  token: string | undefined,
  sendGate: SenderSendGate,
  slackNotifier: SlackHourlyLimitNotifier,
): Promise<EmailJobProcessingResult> {
  const { emailJobId } = job.data;
  const emailJob = await prisma.emailJob.findUnique({
    where: { id: emailJobId },
    include: { sender: true },
  });

  if (!emailJob) {
    console.warn(`Queue job ${job.id} references missing EmailJob ${emailJobId}; skipped.`);
    return { status: 'skipped', emailJobId, reason: 'missing' };
  }

  if (emailJob.status !== EmailStatus.SCHEDULED) {
    console.info(`EmailJob ${emailJobId} is ${emailJob.status}; duplicate processing skipped.`);
    return { status: 'skipped', emailJobId, reason: emailJob.status };
  }

  const campaignId = emailJob.idempotencyKey.split(':', 1)[0] ?? emailJob.id;
  const effectiveHourlyLimit = Math.min(emailJob.maxEmailsPerHour, config.maxEmailsPerHourPerSender);
  const permit = await sendGate.reserve(emailJob.senderId, emailJob.minDelayMs, effectiveHourlyLimit, campaignId);
  if (!permit.allowed) {
    if (permit.reason === 'hourly_limit') {
      await slackNotifier.notify({
        senderId: emailJob.senderId,
        tenantId: emailJob.tenantId,
        senderEmail: emailJob.sender.email,
        hourlyLimit: effectiveHourlyLimit,
        hourWindowStart: permit.hourWindowStart,
        retryAt: permit.retryAt,
      });
    }
    if (!token) throw new Error(`BullMQ lock token missing for rate-limited job ${job.id}.`);
    await job.moveToDelayed(permit.retryAt, token);
    console.info('EmailJob delayed by the sender send gate.', {
      emailJobId,
      senderId: emailJob.senderId,
      retryAt: new Date(permit.retryAt).toISOString(),
    });
    throw new DelayedError();
  }

  const claim = await prisma.emailJob.updateMany({
    where: { id: emailJobId, status: EmailStatus.SCHEDULED },
    data: { status: EmailStatus.SENDING },
  });

  if (claim.count !== 1) {
    console.info(`EmailJob ${emailJobId} was claimed by another worker; skipped.`);
    return { status: 'skipped', emailJobId, reason: 'already-claimed' };
  }

  let result: EtherealEmailResult;
  try {
    result = await sendEtherealEmail({
      recipientEmail: emailJob.recipientEmail,
      subject: emailJob.subject,
      body: emailJob.body,
      senderEmail: emailJob.sender.email,
      senderDisplayName: emailJob.sender.displayName,
    });
  } catch (error) {
    const failureReason = toSafeSmtpFailureReason(error);
    const update = await prisma.emailJob.updateMany({
      where: { id: emailJobId, status: EmailStatus.SENDING },
      data: {
        status: EmailStatus.FAILED,
        sentAt: null,
        failureReason,
      },
    });

    if (update.count !== 1) {
      throw new Error(`SMTP failed for EmailJob ${emailJobId}, and FAILED status could not be saved.`);
    }

    await indexEmailJobByIdSafely(emailJobId, 'failed');

    console.error(`EmailJob ${emailJobId} failed during SMTP delivery: ${failureReason}`);
    return { status: 'failed', emailJobId, reason: failureReason };
  }

  const update = await prisma.emailJob.updateMany({
    where: { id: emailJobId, status: EmailStatus.SENDING },
    data: {
      status: EmailStatus.SENT,
      sentAt: new Date(),
      failureReason: null,
    },
  });

  if (update.count !== 1) {
    throw new Error(`EmailJob ${emailJobId} was sent, but its SENT status could not be saved.`);
  }

  await indexEmailJobByIdSafely(emailJobId, 'sent');

  console.info('EmailJob sent through Ethereal SMTP.', {
    emailJobId,
    messageId: result.messageId,
    ...(result.previewUrl ? { previewUrl: result.previewUrl } : {}),
  });
  return { status: 'sent', emailJobId };
}
