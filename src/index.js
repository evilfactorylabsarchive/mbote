const feedSub = require('feedsub')
const fetch = require('node-fetch')

const rssList = require('./member').rss

const has = Function.call.bind(Object.hasOwnProperty)

const webhook = process.env.DISCORD_WEBHOOK_FOR_RSS
const github = process.env.GITHUB_FOR_RSS

let cachedData = null
let isExecuted = false
let timer = 0

const feedConfig = {
  emitOnStart: true,
  autoStart: true
}

/**
 * ===========
 * Explanation
 * ===========
 *
 * since we don't use any database, we need an "entity" to persist it
 * so the bot will not send the "same content" to our discord server
 * in this case, we use "document-ish style" database.
 * think like sqlite but with mongodb style.
 * why we do this? because we use Zeit Now for deployment
 * and we can't rely on in-memory database/cache, since Zeit Now deployment is immutable.
 * this script will be executed once per-minute via "cron-ish" a.k.a uptime robot
 *
 * sooooo, how it works?
 *
 * 1. As always, get the link
 * 2. Does the link is exists in cached.json?
 * 3. We use `link` key as a checksum.
 * 4. If exists, just skip it (don't send the webhook or write to the disk)
 * 5. If not, send to discord! then write it to the disk (cached.json) **synchronously**
 * ...as a cache via our in-memory cached data.
 * 6. If something unexcepted behavior happens (failed to send to discord), just error it.
 * ...and don't write to the cache. So the program can send it later.
 * 7. There is no step 7
 */

/**
 * virtual file explained
 * soooo now we are using GitHub to persistence our cached.json
 * it is just a regular file, but instead we update via fs, we just
 * tell github to update our cached.json via via API in git commit-ish way
 *
 * how it works?
 *
 * imagine how we get content from `const cachedData = require('./cached.json')`
 * it's similar with this:
 * fetch('https://api.github.com/repos/evilfactorylabs/mbote/contents/src/cached.json')
 * await _.json()
 * return res.content // base64-encoded content
 *
 * to make it human readable, just base64-decode it:
 *
 * const cachedData = btoa(thatRequest) // plain text content
 *
 * so, assuming we update our file. (once again) instead of "write it" to fs
 * we just send POST request to GitHub. ref: https://git.io/fjaJX
 *
 * easy, right?
 *
 * not either 😎
 *
 * read the code pls
 *
 */

const baseUrl = 'https://api.github.com/repos'
const contentUrl = '/evilfactorylabs/mbote/contents/src/cached.json'
const fileUrl = baseUrl + contentUrl

const base64 = {
  encode: data => Buffer.from(data).toString('base64'),
  decode: data => Buffer.from(data, 'base64').toString()
}

const getCachedData = async () => {
  const getData = await fetch(fileUrl, {
    method: 'GET',
    headers: {
      Authorization: `token ${github}`
    }
  })
  const data = await getData.json()
  return data
}

const updateCachedData = async data => {
  // first, we need to make sure we update cached.json
  // from the latest ones
  const currentCacheData = await getCachedData()
  // second, since GitHub store our blob as base64, we need to decode it
  const $currentContent = base64.decode(currentCacheData.content)
  // third, yes, that is a string! not actual object
  const currentContent = JSON.parse($currentContent)
  // last, combine our "newest" data to the cache queue
  const newContent = currentContent.concat(data.content)

  const payload = {
    message: `chore(cache): add ${data.link} to cache`,
    commiter: {
      name: 'mbote bot',
      email: 'mbote@evilfactory.id'
    },
    sha: currentCacheData.sha,
    content: base64.encode(JSON.stringify(newContent))
  }
  const req = await fetch(fileUrl, {
    method: 'PUT',
    body: JSON.stringify(payload),
    headers: {
      Authorization: `token ${github}`
    }
  })
  const res = await req.json()
  return res
}

const getByProp = (obj, prop) =>
  typeof prop === 'string'
    ? prop.split('.').reduce((acc, cur, _) => acc[cur], obj)
    : obj

const handleItem = (item, format) => {
  const formatter = format.split('|')
  const normalize = ['title', 'link']
  const data = formatter.reduce((acc, cur, idx) => {
    acc[normalize[idx]] = has(item, cur)
      ? item[cur]
      : getByProp(item, cur) || 'New Post!'
    return acc
  }, {})

  validateItem(data)
}

const validateItem = async data => {
  // check is incoming data was exists in our cached data?
  // if yes, just skip it.
  const isLinkExists = cachedData.filter(cached => cached.link === data.link)

  // if no
  if (isLinkExists.length === 0) {
    // send it to discord! it means, someone create new post
    sendToDiscrot(data, async function() {
      const payload = {
        link: data.link,
        content: data
      }
      // then we store it to our beloved cache
      await updateCachedData(payload)
    })
  }
}

const sendToDiscrot = (data, cb) => {
  // Discord have API Rate Limit with threshold 5000ms (assumed)
  // since we don't know the exact number, let's just debounce it
  // every 5s. play safe everybodeeh

  const queue = setTimeout(() => {
    fetch(webhook, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        content: `${data.title} - ${data.link}`
      })
    }).then(() => {
      // flush "queue" after webhook executed
      clearTimeout(queue)
      // after webhook was sent, update our cache
      cb(data)
    })
  }, timer)

  // increment timer for the next task
  // i am using "naive" solution for this, but whatever
  // send the PR if you have better solution
  timer += 5000
}

module.exports = async () => {
  // get previous cached rss so we can compare
  // it with the newest ones
  let $cachedData = await getCachedData()
  $cachedData = base64.decode($cachedData.content)
  cachedData = JSON.parse($cachedData)
  // prevent multiple listener
  if (isExecuted) {
    return 'cool'
  } else {
    isExecuted = true
    rssList.forEach(({ rss, format }) => {
      const reader = new feedSub(rss, feedConfig)
      reader.on('item', item => handleItem(item, format))
    })
    return 'ok'
  }
}
