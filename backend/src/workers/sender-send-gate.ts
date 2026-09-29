import type { Redis } from 'ioredis';

const RATE_LIMIT_SCRIPT = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local hour = 3600000
local windowStart = math.floor(now / hour) * hour
local windowEnd = windowStart + hour
local countKey = KEYS[1] .. ':hour:' .. tostring(windowStart)
local campaignCountKey = KEYS[3] .. ':hour:' .. tostring(windowStart)
local nextSendAt = tonumber(redis.call('GET', KEYS[2]) or '0')
local count = tonumber(redis.call('GET', countKey) or '0')
local campaignCount = tonumber(redis.call('GET', campaignCountKey) or '0')
local limit = tonumber(ARGV[1])
local minDelayMs = tonumber(ARGV[2])
local campaignLimit = tonumber(ARGV[3])

if count >= limit or campaignCount >= campaignLimit then
  local retryAt = windowEnd
  if nextSendAt > retryAt then
    retryAt = nextSendAt
  end
  return {0, retryAt, 2, windowStart, windowEnd}
end

if nextSendAt > now then
  return {0, nextSendAt, 1, windowStart, windowEnd}
end

redis.call('INCR', countKey)
redis.call('PEXPIRE', countKey, 172800000)
redis.call('INCR', campaignCountKey)
redis.call('PEXPIRE', campaignCountKey, 172800000)
redis.call('SET', KEYS[2], tostring(now + minDelayMs), 'PX', 172800000)
return {1, now, 0, windowStart, windowEnd}
`;

export type SenderSendPermit =
  | { allowed: true; reservedAt: number; hourWindowStart: number; hourWindowEnd: number }
  | {
      allowed: false;
      reason: 'minimum_delay' | 'hourly_limit';
      retryAt: number;
      hourWindowStart: number;
      hourWindowEnd: number;
    };

export class SenderSendGate {
  constructor(
    private readonly redis: Redis,
    private readonly minDelayMs: number,
    private readonly maxPerHour: number,
  ) {}

  async reserve(senderId: string, requestedDelayMs = this.minDelayMs, requestedHourlyLimit = this.maxPerHour, campaignId = 'default'): Promise<SenderSendPermit> {
    const senderKey = `reachinbox:send-gate:sender:${senderId}`;
    const result = (await this.redis.eval(
      RATE_LIMIT_SCRIPT,
      3,
      `${senderKey}:quota`,
      `${senderKey}:next-send-at`,
      `reachinbox:send-gate:campaign:${campaignId}:sender:${senderId}:quota`,
      this.maxPerHour,
      Math.max(this.minDelayMs, requestedDelayMs),
      Math.min(this.maxPerHour, requestedHourlyLimit),
    )) as [number | string, number | string, number | string, number | string, number | string];

    const [allowed, timestamp, reasonCode, hourWindowStart, hourWindowEnd] = result.map(Number);
    if (allowed === 1) {
      return { allowed: true, reservedAt: timestamp, hourWindowStart, hourWindowEnd };
    }
    return {
      allowed: false,
      reason: reasonCode === 2 ? 'hourly_limit' : 'minimum_delay',
      retryAt: timestamp,
      hourWindowStart,
      hourWindowEnd,
    };
  }
}
