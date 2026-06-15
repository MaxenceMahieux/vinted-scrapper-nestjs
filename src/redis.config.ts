import { ConfigService } from '@nestjs/config';

/**
 * Connection options Redis communes a BullMQ et au healthcheck.
 *
 * Supporte l'authentification (REDIS_USERNAME / REDIS_PASSWORD) requise par
 * les Redis manages (ex. Coolify), en plus de REDIS_HOST / REDIS_PORT.
 */
export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export function buildRedisOptions(
  config: ConfigService,
): RedisConnectionOptions {
  const username = config.get<string>('REDIS_USERNAME');
  const password = config.get<string>('REDIS_PASSWORD');

  return {
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: config.get<number>('REDIS_PORT', 6379),
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  };
}
