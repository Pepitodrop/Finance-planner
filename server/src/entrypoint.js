import { spawn } from 'node:child_process'
import { createServer, request as httpRequest } from 'node:http'
import { URL } from 'node:url'
import { createTestEnrollmentHandler } from './test-enrollment.js'

const env = process.env
const publicPort = Number(env.PORT || 8787)
const publicHost = env.HOST || '0.0.0.0'
const internalPort = Number(env.INTERNAL_CONNECTOR_PORT || 8788)
const origin = env.APP_ORIGIN || 'http://localhost:5173'
const sessionSecret = env.SESSION_SECRET || ''
let child = null
let restarting = false

function startChild() {
  child = spawn(process.execPath, ['src/server.js'], {
    stdio: 'inherit',
    env: { ...env, HOST: '127.0.0.1', PORT: String(internalPort) },
  })
  child.once('exit', (code, signal) => {
    if (restarting) return
    console.error(JSON.stringify({ level: 'error', event: 'connector_child_exit', code, signal }))
    process.exit(code || 1)
  })
}

async function restartChild() {
  if (!child || restarting) return
  restarting = true
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5_000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    child.kill('SIGTERM')
  })
  restarting = false
  startChild()
}

startChild()
const handleEnrollment = await createTestEnrollmentHandler({ env, origin, sessionSecret, onEnrolled: restartChild })

const proxy = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    if (await handleEnrollment(request, response, url)) return

    const upstream = httpRequest({
      host: '127.0.0.1',
      port: internalPort,
      method: request.method,
      path: request.url,
      headers: { ...request.headers, host: `127.0.0.1:${internalPort}` },
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers)
      upstreamResponse.pipe(response)
    })
    upstream.on('error', (error) => {
      if (response.headersSent) return response.destroy(error)
      response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify({ error: { code: 'connector_starting', message: 'Finance Planner service is starting.' } }))
    })
    request.pipe(upstream)
  } catch (error) {
    response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify({ error: { code: 'test_enrollment_failed', message: error instanceof Error ? error.message : 'Enrollment failed.' } }))
  }
})

function shutdown(signal) {
  child?.kill(signal)
  proxy.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
proxy.listen(publicPort, publicHost, () => console.log(JSON.stringify({ level: 'info', event: 'connector_entrypoint_listening', host: publicHost, port: publicPort, internalPort })))
