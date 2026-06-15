import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import Redis from 'ioredis';
import { buildRedisOptions } from '../redis.config';

/**
 * Terminus health indicator that pings Redis using a dedicated ioredis
 * connection built from REDIS_HOST / REDIS_PORT (+ optional auth).
 */
@Injectable()
export class RedisHealthIndicator
  extends HealthIndicator
  implements OnModuleDestroy
{
  private readonly logger = new Logger(RedisHealthIndicator.name);
  private readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    super();
    this.client = new Redis({
      ...buildRedisOptions(this.config),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const pong = await this.client.ping();
      return this.getStatus(key, pong === 'PONG');
    } catch (error) {
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, {
          message: error instanceof Error ? error.message : 'unknown error',
        }),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch (error) {
      this.logger.warn(
        `Failed to close Redis health connection: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
