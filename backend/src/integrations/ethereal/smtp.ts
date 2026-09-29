import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface EtherealSmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  fromEmail?: string;
  fromName?: string;
}

export interface EtherealEmailInput {
  recipientEmail: string;
  subject: string;
  body: string;
  senderEmail: string;
  senderDisplayName: string | null;
}

export interface EtherealEmailResult {
  messageId: string;
  previewUrl?: string;
}

let reusableTransport: Transporter | undefined;

export function readEtherealSmtpConfig(): EtherealSmtpConfig {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT);
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;

  const missing: string[] = [];
  if (!host) missing.push('SMTP_HOST');
  if (!Number.isInteger(port) || port < 1 || port > 65535) missing.push('SMTP_PORT');
  if (!user) missing.push('SMTP_USER');
  if (!password) missing.push('SMTP_PASSWORD');

  if (missing.length > 0) {
    throw new Error(`Ethereal SMTP configuration is incomplete: ${missing.join(', ')}.`);
  }

  return {
    host: host!,
    port,
    user: user!,
    password: password!,
    fromEmail: process.env.SMTP_FROM_EMAIL?.trim() || undefined,
    fromName: process.env.SMTP_FROM_NAME?.trim() || undefined,
  };
}

export function createEtherealTransport(config: EtherealSmtpConfig): Transporter {
  const secure = config.port === 465;

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure,
    requireTLS: !secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
  });
}

export async function sendEtherealEmail(input: EtherealEmailInput): Promise<EtherealEmailResult> {
  const config = readEtherealSmtpConfig();
  reusableTransport ??= createEtherealTransport(config);

  const senderEmail = input.senderEmail.trim() || config.fromEmail;
  if (!senderEmail) {
    throw new Error('Email sender address is missing from both the database and SMTP_FROM_EMAIL.');
  }

  const senderDisplayName = input.senderDisplayName?.trim() || config.fromName;
  const info = await reusableTransport.sendMail({
    from: senderDisplayName
      ? { name: senderDisplayName, address: senderEmail }
      : { address: senderEmail },
    to: input.recipientEmail,
    subject: input.subject,
    text: input.body,
  });

  const preview = nodemailer.getTestMessageUrl(info);
  return {
    messageId: info.messageId,
    ...(typeof preview === 'string' ? { previewUrl: preview } : {}),
  };
}

export function toSafeSmtpFailureReason(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : 'Unknown SMTP error.';
  const secrets = [process.env.SMTP_PASSWORD, process.env.SMTP_USER]
    .filter((secret): secret is string => Boolean(secret));

  const redactedMessage = secrets.reduce(
    (message, secret) => message.replaceAll(secret, '[redacted]'),
    rawMessage,
  );

  return redactedMessage.slice(0, 2000);
}
