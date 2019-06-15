const feedSub = require('feedsub')
const fetch = require('node-fetch')
const rssList = require('./member.json').rss
const has = Function.call.bind(Object.hasOwnProperty)
const webhook = process.env.DISCORD_WEBHOOK

const feedConfig = {
  interval: 0.5,
  emitOnStart: true,
  autoStart: true
}

const getByProp = (obj, prop) =>
  typeof prop === 'string'
    ? prop.split('.').reduce((acc, cur, idx) => acc[cur], obj)
    : obj

const handleItem = (item, format) => {
  const formatter = format.split('|')
  const normalize = ['title', 'link']
  const data = formatter.reduce((acc, cur, idx) => {
    acc[normalize[idx]] = has(item, cur)
      ? item[cur]
      : getByProp(item, cur) || 'New Post!!!!'
    return acc
  }, {})

  setTimeout(fetch, Math.random() * (5000 - 2000) + 2000, webhook, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      content: `${data.title} - ${data.link}`
    })
  })
}

setInterval(
  () =>
    rssList.forEach(({ rss, format }) => {
      const reader = new feedSub(rss, feedConfig)
      reader.on('item', item => handleItem(item, format))
    }),
  2000
)
if (process.platform === 'win32') {
  var rl = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  })

  rl.on('SIGINT', function() {
    process.emit('SIGINT')
  })
}

process.on('SIGINT', function() {
  //graceful shutdown
  process.exit()
})
