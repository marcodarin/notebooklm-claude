import pino from 'pino'

const level = process.env.LOG_LEVEL || 'info'

export const logger = pino({
  level,
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  serializers: {
    err: pino.stdSerializers.err,
  },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'cookie', 'token'],
    censor: '[REDACTED]',
  },
})
