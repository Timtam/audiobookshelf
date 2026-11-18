const { expect } = require('chai')
const sinon = require('sinon')
const Path = require('path')
const os = require('os')
const nodeFs = require('fs')

const fs = require('../../../server/libs/fsExtra')
const Logger = require('../../../server/Logger')
const ffmpegHelpers = require('../../../server/utils/ffmpegHelpers')
const TaskManager = require('../../../server/managers/TaskManager')
const AbMergeManager = require('../../../server/managers/AbMergeManager')

describe('AbMergeManager', () => {
  let tempDir = null
  let originalMetadataPath = null
  /** @type {AbMergeManager} */
  let abMergeManager = null

  /**
   * Library item with files in the temp dir
   */
  function createLibraryItem(name) {
    const itemPath = Path.join(tempDir, 'library', name)
    nodeFs.mkdirSync(itemPath, { recursive: true })
    const audioFiles = ['01.mp3', '02.mp3'].map((filename, index) => {
      const path = Path.join(itemPath, filename)
      nodeFs.writeFileSync(path, `${name} track ${index + 1}`)
      return { index: index + 1, ino: `${name}-${index + 1}`, duration: 60, metadata: { filename, path, ext: '.mp3' } }
    })
    nodeFs.writeFileSync(Path.join(itemPath, 'cover.jpg'), 'cover')
    return {
      id: `li-${name}`,
      isFile: false,
      path: itemPath,
      media: {
        title: name,
        subtitle: null,
        authorName: 'Author',
        genres: [],
        narrators: [],
        series: [],
        chapters: [{ id: 0, start: 0, end: 120, title: 'Chapter 1' }],
        coverPath: Path.join(itemPath, 'cover.jpg'),
        duration: 120,
        includedAudioFiles: audioFiles
      }
    }
  }

  beforeEach(() => {
    tempDir = nodeFs.mkdtempSync(Path.join(os.tmpdir(), 'abs-merge-test-'))
    nodeFs.mkdirSync(Path.join(tempDir, 'metadata', 'cache', 'items'), { recursive: true })
    originalMetadataPath = global.MetadataPath
    global.MetadataPath = Path.join(tempDir, 'metadata')

    sinon.stub(Logger, 'info')
    sinon.stub(Logger, 'debug')

    abMergeManager = new AbMergeManager()
  })

  afterEach(async () => {
    sinon.restore()
    TaskManager.tasks = []
    global.MetadataPath = originalMetadataPath
    await fs.remove(tempDir)
  })

  describe('runAudiobookMerge', () => {
    it('should embed metadata and cover in the encode run and move the m4b to the library item folder', async () => {
      const mergeAudioFilesStub = sinon.stub(ffmpegHelpers, 'mergeAudioFiles').callsFake(async (audioTracks, duration, itemCachePath, outputFilePath) => {
        nodeFs.writeFileSync(outputFilePath, 'encoded m4b')
      })
      const runAudiobookMergeSpy = sinon.spy(abMergeManager, 'runAudiobookMerge')
      const libraryItem = createLibraryItem('Book 1')
      const itemCachePath = Path.join(global.MetadataPath, 'cache', 'items', libraryItem.id)

      await abMergeManager.startAudiobookMerge('user1', libraryItem)
      await runAudiobookMergeSpy.firstCall.returnValue

      const [audioTracks, , , outputFilePath, , , ffmpeg, metadataFilePath, coverFilePath] = mergeAudioFilesStub.firstCall.args
      expect(audioTracks).to.equal(libraryItem.media.includedAudioFiles)
      expect(outputFilePath).to.equal(Path.join(itemCachePath, 'Book 1.m4b'))
      expect(ffmpeg.options.niceness).to.equal(10)
      expect(metadataFilePath).to.equal(Path.join(itemCachePath, 'ffmetadata.txt'))
      expect(coverFilePath).to.equal(libraryItem.media.coverPath)

      // The m4b replaces the tracks, the original tracks are kept in the item cache
      expect(nodeFs.readdirSync(libraryItem.path).sort()).to.deep.equal(['Book 1.m4b', 'cover.jpg'])
      expect(nodeFs.readFileSync(Path.join(libraryItem.path, 'Book 1.m4b'), 'utf8')).to.equal('encoded m4b')
      expect(nodeFs.readdirSync(itemCachePath).sort()).to.deep.equal(['01.mp3', '02.mp3'])
      expect(abMergeManager.pendingTasks).to.have.length(0)
    })
  })
})
