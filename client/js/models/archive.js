const memdb = require('memdb')
const hyperdrive = require('hyperdrive')
const swarm = require('hyperdrive-archive-swarm')
const HyperdriveImportQueue = require('hyperdrive-import-queue')
const drop = require('drag-drop')
const speedometer = require('speedometer')
const Jszip = require('jszip')
const saveAs = require('file-saver').saveAs
const Promise = require('es6-promise').Promise
const getMetadata = require('../utils/metadata.js')

var drive = hyperdrive(memdb())
var hyperdriveImportQueue
var noop = function () {}

var defaultState = {
  key: null,
  instance: null,
  file: null,
  error: null,
  metadata: {},
  entries: [],
  root: '',
  size: null,
  numPeers: 0,
  swarm: null,
  signalhubs: [
    'signalhub.mafintosh.com',
    'signalhub.dat.land'
  ],
  uploadMeter: null,
  uploadSpeed: 0,
  uploadTotal: 0,
  downloadMeter: null,
  downloadSpeed: 0,
  downloadTotal: 0,
  importQueue: {
    writing: null,
    writingProgressPct: null,
    next: []
  }
}

module.exports = {
  namespace: 'archive',
  state: defaultState,
  reducers: {
    update: (data, state) => {
      return data
    },
    updateDownloaded: (downloaded, state) => {
      const meter = state.downloadMeter || speedometer(3)
      return {
        downloadMeter: meter,
        downloadTotal: (state.downloadTotal || 0) + downloaded,
        downloadSpeed: meter(downloaded)
      }
    },
    updateUploaded: (uploaded, state) => {
      const meter = state.uploadMeter || speedometer(3)
      return {
        uploadMeter: meter,
        uploadTotal: (state.uploadTotal || 0) + uploaded,
        uploadSpeed: meter(uploaded)
      }
    },
    updatePeers: (data, state) => {
      return {numPeers: state.swarm ? state.swarm.connections : 0}
    },
    reset: (data, state) => {
      if (state.swarm && state.swarm.close) state.swarm.close(function () {})
      return defaultState
    },
    updateImportQueue: (data, state) => {
      // shallow copy the last `state` frame so we can preserve
      // file.progressListener refs:
      var stateCopy = {}
      stateCopy.writing = state.importQueue.writing
      stateCopy.writingProgressPct = state.importQueue.writingProgressPct
      stateCopy.next = state.importQueue.next
      // new file is enqueued:
      if (data.onQueueNewFile) stateCopy.next.push(data.file)
      // next file begins writing:
      if (data.onFileWriteBegin) {
        stateCopy.writing = stateCopy.next[0]
        stateCopy.next = stateCopy.next.slice(1)
      }
      // write progress on current file writing:
      if (data.writing && data.writing.fullPath && data.writingProgressPct) {
        if (stateCopy.writing && (stateCopy.writing.fullPath === data.writing.fullPath)) {
          stateCopy.writingProgressPct = data.writingProgressPct
        }
      }
      // current file is done writing:
      if (data.onFileWriteComplete) {
        stateCopy.writing = null
        stateCopy.writingProgressPct = null
      }
      return {
        importQueue: {
          writing: stateCopy.writing,
          writingProgressPct: stateCopy.writingProgressPct,
          next: stateCopy.next
        }
      }
    },
    resetImportQueue: (data, state) => {
      var writing = state.importQueue.writing
      if (writing && writing.progressListener && writing.progressHandler) {
        writing.progressListener.removeListener('progress', writing.progressHandler)
      }
      return defaultState.importQueue
    }
  },
  subscriptions: [
    (send, done) => {
      drop(document.body, (files) => send('archive:importFiles', {files}, done))
    }
  ],
  effects: {
    new: function (data, state, send, done) {
      // reset archive model properly
      if (state.instance) {
        send('archive:resetImportQueue', {}, noop)
        send('archive:reset', {}, noop)
      }
      // init new archive model
      const archive = drive.createArchive(null, {live: true, sparse: true})
      const key = archive.key.toString('hex')
      send('archive:update', {instance: archive, swarm: swarm(archive), key}, noop)
      send('archive:import', key, done)
      send('archive:initImportQueue', {archive}, noop)
    },
    import: function (key, state, send, done) {
      const location = '/' + key
      send('location:setLocation', { location }, noop)
      window.history.pushState({}, null, location)
      send('archive:update', {entries: [], numPeers: 0, downloadTotal: 0, uploadTotal: 0, size: 0}, noop)
      send('archive:load', key, done)
    },
    updateMetadata: function (data, state, send, done) {
      getMetadata(state.instance, function (err, metadata) {
        if (err) return done(err)
        send('archive:update', {metadata}, done)
      })
    },
    importFiles: function (data, state, send, done) {
      var files = data.files
      const archive = state.instance
      if (data.createArchive || !archive) {
        send('archive:new', null, () => send('archive:importFiles', {files}, done))
        return
      }
      if (!archive.owner) {
        // XXX: use error in state
        window.alert('You cannot put files in this archive')
        return done()
      }
      if (!Array.isArray(files)) {
        // arrayify FileList
        files = Array.prototype.slice.call(files, 0)
        for (var i in files) {
          files[i].fullPath = '/' + files[i].name
        }
      }
      hyperdriveImportQueue.add(files, state.root)
      return done()
    },
    initImportQueue: function (data, state, send, done) {
      send('archive:resetImportQueue', {}, noop)
      hyperdriveImportQueue = HyperdriveImportQueue(null, data.archive, {
        onQueueNewFile: function (err, file) {
          if (err) console.log(err)
          send('archive:updateImportQueue', {onQueueNewFile: true, file: file}, noop)
        },
        onFileWriteBegin: function (err, file) {
          if (err) console.log(err)
          if (file && !file.progressHandler) {
            file.progressHandler = (progress) => {
              const pct = parseInt(progress.percentage)
              send('archive:updateImportQueue', {writing: file, writingProgressPct: pct}, function () {})
            }
            file.progressListener.on('progress', file.progressHandler)
          }
          send('archive:updateImportQueue', {onFileWriteBegin: true}, noop)
        },
        onFileWriteComplete: function (err, file) {
          if (err) console.log(err)
          if (file && file.progressListener && file.progressHandler) {
            file.progressListener.removeListener('progress', file.progressHandler)
          }
          if (file.fullPath === '/dat.json') send('archive:updateMetadata', {}, noop)
          send('archive:updateImportQueue', {onFileWriteComplete: true}, noop)
        }
      })
    },
    load: function (key, state, send, done) {
      var archive, sw, timer
      if (state.instance && state.instance.drive) {
        if (state.instance.key.toString('hex') === key) {
          archive = state.instance
          sw = state.swarm
        } else {
          archive = null
        }
      }
      if (!archive) {
        archive = drive.createArchive(key)
        sw = swarm(archive)
        send('archive:update', {instance: archive, swarm: sw, key}, done)
      }
      sw.on('connection', function (conn) {
        send('archive:updatePeers', noop)
        conn.on('close', function () {
          send('archive:updatePeers', noop)
        })
      })
      archive.on('upload', function (data) {
        send('archive:updateUploaded', data.length, noop)
        if (timer) window.clearTimeout(timer)
        timer = setTimeout(() => send('archive:update', {uploadSpeed: 0, downloadSpeed: 0}, noop), 3000)
      })
      archive.on('download', function (data) {
        send('archive:updateDownloaded', data.length, noop)
        send('archive:updateMetadata', {}, noop)
        if (timer) window.clearTimeout(timer)
        timer = setTimeout(() => send('archive:update', {uploadSpeed: 0, downloadSpeed: 0}, noop), 3000)
      })
      archive.open(function () {
        if (archive.content) {
          archive.content.get(0, function (data) {
            send('archive:update', {size: archive.content.bytes}, noop)
            // XXX: Hack to fetch a small bit of data so size properly updates
          })
        }
        send('archive:updateMetadata', {}, noop)
      })
      return done()
    },
    readFile: function (data, state, send, done) {
      var archive = state.instance
      var readStream = archive.createFileReadStream(data.entryName)
      done(readStream)
    },
    downloadAsZip: function (data, state, send, done) {
      const archive = state.instance
      const zip = new Jszip()
      var zipName
      var promises = []

      if (data && data.entryName) { // single file download as zip
        zipName = data.entryName
        var promise = new Promise(function(resolve, reject) {
          archive.get(data.entryName, {timeout: 1500}, function (err, entry) {
            if (err) return reject()
            zip.file(data.entryName, archive.createFileReadStream(data.entryName))
            resolve()
          })
        })
        promises.push(promise)
      } else { // download entire archive as zip
        zipName = state.key
        var keys = Object.keys(state.entries.sort())
        keys.forEach((key, i) => {
          const entry = state.entries[key]
          if (entry && entry.type === 'file') {
            var promise = new Promise(function (resolve, reject) {
              archive.get(entry.name, {timeout: 1500}, function (err, entry) {
                if (err) return reject()
                zip.file(entry.name, archive.createFileReadStream(entry.name))
                resolve()
              })
            })
            promises.push(promise)
          }
        })
      }

      return Promise.all(promises)
        .then(function () {
          zip
          .generateAsync({type: 'blob'})
          .then((content) => {
            saveAs(content, `${zipName}.zip`)
            done()
          })
        })
        .catch(function () {
          window.alert('We cannot find peers to download this dat from at this time. Try using the dat desktop app instead.')
        })
    }
  }
}
