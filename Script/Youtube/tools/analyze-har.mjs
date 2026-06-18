#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

const input = process.argv[2]

if (!input) {
  console.error('Usage: node tools/analyze-har.mjs <capture.har>')
  process.exit(1)
}

const interestingHosts = [
  'youtubei.googleapis.com',
  'www.youtube.com',
  's.youtube.com',
  'googlevideo.com'
]

const selectedParams = [
  'id',
  'rn',
  'cpn',
  'c',
  'oad',
  'itag',
  'mime',
  'clen',
  'dur'
]

function getUrl (entry) {
  try {
    return new URL(entry.request.url)
  } catch {
    return null
  }
}

function isInterestingHost (host) {
  return interestingHosts.some((item) => host === item || host.endsWith(`.${item}`))
}

function getHeader (headers = [], name) {
  return headers.find((header) => header.name?.toLowerCase() === name)?.value ?? ''
}

function getPostLength (entry) {
  const postData = entry.request.postData
  if (!postData) return 0
  if (typeof postData.text === 'string') return Buffer.byteLength(postData.text)
  return Number(postData._transferSize ?? postData.size ?? 0) || 0
}

function getResponseLength (entry) {
  const content = entry.response.content
  return Number(content?.size ?? entry.response.bodySize ?? 0) || 0
}

function getQuerySummary (url) {
  const pairs = []
  for (const key of selectedParams) {
    const value = url.searchParams.get(key)
    if (value) pairs.push(`${key}=${value}`)
  }
  return pairs.join(' ')
}

function classify (url, entry) {
  const path = url.pathname
  if (url.hostname.includes('googlevideo.com') && path.includes('/initplayback')) return 'initplayback'
  if (url.hostname.includes('googlevideo.com') && path.includes('/videoplayback')) return 'videoplayback'
  if (path.includes('/youtubei/v1/')) return path.replace(/^.*\/youtubei\/v1\//, 'youtubei/')
  if (url.hostname === 's.youtube.com') return `stats${path}`
  if (url.hostname === 'www.youtube.com') return `www${path}`
  return path || entry.request.url
}

function summarizeEntry (entry, index, firstStarted) {
  const url = getUrl(entry)
  if (!url) return null
  if (!isInterestingHost(url.hostname)) return null

  const started = new Date(entry.startedDateTime).getTime()
  const offset = Number.isFinite(started) && Number.isFinite(firstStarted)
    ? `${((started - firstStarted) / 1000).toFixed(3)}s`
    : `${index}`
  const mime = entry.response.content?.mimeType || getHeader(entry.response.headers, 'content-type') || '-'
  const query = getQuerySummary(url)
  return {
    offset,
    method: entry.request.method,
    type: classify(url, entry),
    status: entry.response.status,
    mime,
    postBytes: getPostLength(entry),
    responseBytes: getResponseLength(entry),
    query
  }
}

const har = JSON.parse(await readFile(input, 'utf8'))
const entries = har.log?.entries ?? []
const firstStarted = Math.min(
  ...entries
    .map((entry) => new Date(entry.startedDateTime).getTime())
    .filter(Number.isFinite)
)
const relevant = entries
  .map((entry, index) => summarizeEntry(entry, index, firstStarted))
  .filter(Boolean)
  .sort((a, b) => Number.parseFloat(a.offset) - Number.parseFloat(b.offset))

const youtubeiCounts = new Map()
let initPlaybackCount = 0
let videoPlaybackCount = 0
let umpCount = 0
let oldPlayerCount = 0
let oldWatchCount = 0

for (const entry of relevant) {
  if (entry.type.startsWith('youtubei/')) {
    youtubeiCounts.set(entry.type, (youtubeiCounts.get(entry.type) ?? 0) + 1)
    if (entry.type === 'youtubei/player') oldPlayerCount++
    if (entry.type === 'youtubei/get_watch') oldWatchCount++
  }
  if (entry.type === 'initplayback') initPlaybackCount++
  if (entry.type === 'videoplayback') videoPlaybackCount++
  if (entry.mime.includes('application/vnd.yt-ump')) umpCount++
}

console.log(`HAR: ${basename(input)}`)
console.log(`Total entries: ${entries.length}`)
console.log(`Relevant entries: ${relevant.length}`)
console.log('')

console.log('YouTube API counts:')
if (youtubeiCounts.size === 0) {
  console.log('  none')
} else {
  for (const [type, count] of [...youtubeiCounts.entries()].sort()) {
    console.log(`  ${type}: ${count}`)
  }
}
console.log('')

console.log('Playback transport:')
console.log(`  initplayback: ${initPlaybackCount}`)
console.log(`  videoplayback: ${videoPlaybackCount}`)
console.log(`  application/vnd.yt-ump responses: ${umpCount}`)
console.log(`  legacy youtubei/player: ${oldPlayerCount}`)
console.log(`  legacy youtubei/get_watch: ${oldWatchCount}`)
console.log('')

console.log('Timeline:')
for (const entry of relevant) {
  const suffix = entry.query ? ` ${entry.query}` : ''
  console.log(
    `${entry.offset.padStart(8)} ${entry.method.padEnd(4)} ${String(entry.status).padEnd(3)} ` +
    `${entry.type.padEnd(34)} post=${String(entry.postBytes).padStart(6)} ` +
    `resp=${String(entry.responseBytes).padStart(8)} ${entry.mime}${suffix}`
  )
}
