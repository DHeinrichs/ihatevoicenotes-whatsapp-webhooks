import express, { Express } from "express"
import { transports, format, createLogger } from "winston"
import { inspect } from "util"
import bodyParser from "body-parser"
import "crypto"
import { createClient } from "redis"
import { middleware as webhookMiddleware } from "x-hub-signature"

/**
 * Required environment variables
 */
;["PORT", "TOKEN", "APP_SECRET", "REDIS_URL", "QUEUE_KEY"].forEach((key) => {
  if (process.env[key] === undefined) {
    console.error(`Environment variable ${key} is required`)
    process.exit(1)
  }
})
const TOKEN = process.env.TOKEN
const PORT = process.env.PORT
const APP_SECRET = process.env.APP_SECRET
const REDIS_URL = process.env.REDISCLOUD_URL
const QUEUE_KEY = process.env.QUEUE_KEY
const LOG_LEVEL = process.env.LOG_LEVEL || "info"

/**
 * Logging
 */
const humanReadableFormat = format.printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${message}`
})
const winstonOptions = {
  level: LOG_LEVEL.toLowerCase(),
  format: format.combine(
    format.timestamp(),
    format.json(),
    humanReadableFormat
  ),
  transports: [new transports.Console()],
}
const logger = createLogger(winstonOptions)

/**
 * Redis
 */
const client = createClient({
  url: REDIS_URL,
})

/**
 * Routes
 */
const app: Express = express()
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`)
  next()
})
app.use(
  bodyParser.json({
    verify: webhookMiddleware.extractRawBody,
  })
)
const verifyXHub = webhookMiddleware({
  algorithm: "sha1",
  secret: APP_SECRET,
  require: true,
})

/**
 * Routes
 */

app.get("/", function (req, res, next) {
  res.json("[]")
})

app.get("/whatsapp", function (req, res) {
  if (
    req.query["hub.mode"] == "subscribe" &&
    req.query["hub.verify_token"] == TOKEN
  ) {
    res.send(req.query["hub.challenge"])
  } else {
    res.sendStatus(400)
  }
})

app.post("/whatsapp", verifyXHub, async (req, res) => {
  logger.debug("WhatsApp request body:")
  logger.debug(inspect(req.body, false, null, true))
  await client.rPush(QUEUE_KEY, [JSON.stringify(req.body)])
  const size = await client.lLen(QUEUE_KEY)
  logger.info(`queued. queue size: ${size}`)
  res.sendStatus(200)
})

// Log any errors
app.use((err, req, res, next) => {
  logger.error(`${req.method} ${req.url} ${err.stack}`)
  next(err)
})

/**
 * Start
 */
const main = async () => {
  client.on("error", (err) => logger.error(`redis Client Error: ${err}`))
  client.connect()
  logger.info("redis client connected")
  app.listen(PORT, () => {
    logger.info(`server listening on port: ${PORT}`)
  })
}

main()
