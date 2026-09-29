import { config } from '../../config/env.js';

export interface SlackOAuthConfiguration {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

export function requireSlackOAuthConfiguration(): SlackOAuthConfiguration {
  const { slackClientId, slackClientSecret, slackRedirectUri, slackTokenEncryptionKey } = config;
  if (!slackClientId || !slackClientSecret || !slackRedirectUri || !slackTokenEncryptionKey) {
    throw new Error('Slack OAuth is not configured. Set Slack client credentials, redirect URI, and encryption key.');
  }

  let callbackUrl: URL;
  try {
    callbackUrl = new URL(slackRedirectUri);
  } catch {
    throw new Error('SLACK_REDIRECT_URI must be an absolute HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(callbackUrl.protocol)) {
    throw new Error('SLACK_REDIRECT_URI must be an absolute HTTP(S) URL.');
  }
  return { clientId: slackClientId, clientSecret: slackClientSecret, callbackUrl: callbackUrl.toString() };
}
