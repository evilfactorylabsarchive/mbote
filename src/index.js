const feedSub = require('feedsub')
const fetch = require('node-fetch')

const { resolve } = require('path')
const { writeFileSync } = require('fs')

const rssList = require('./member').rss
const cachedData = require('./cached')

const has = Function.call.bind(Object.hasOwnProperty)
const webhook = process.env.DISCORD_WEBHOOK_FOR_RSS

// TODO(108kb): convert this using virtual files
// via GitHub API
const cacheFile = 'cached.json'

let isExecuted = false
let timer = 0

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

const feedConfig = {
  emitOnStart: true,
  autoStart: true
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

const validateItem = data => {
  // check is incoming data was exists in our cached data?
  // if yes, just skip it.
  const isLinkExists = cachedData.filter(cached => cached.link === data.link)

  // if no
  if (isLinkExists.length === 0) {
    // send it to discord! it means, someone create new post
    sendToDiscrot(data, function() {
      // then we store it to our beloved in-memory cache
      cachedData.push(data)
      // write it to our persistence entitiy
      writeFileSync(
        resolve(__dirname, cacheFile),
        JSON.stringify(cachedData),
        err => {
          if (err) throw err
        }
      )
    })
  }
}

const sendToDiscrot = (data, cb) => {
  // Discord have API Rate Limit with treshold 5000ms (assumed)
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

module.exports = () => {
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

// TODO: how to sync the `cached.json` file with our git repository?
