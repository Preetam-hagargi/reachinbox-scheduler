import { Redis } from 'ioredis';
import { config } from '../config/env.js';

export function createRedisConnection(): Redis {
  const connection = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
  });

  connection.on('error', (error: Error) => {
    console.error('Redis connection error:', error.message);
  });

  return connection;
}
