const { expect } = require('chai')
const { Sequelize } = require('sequelize')

const Database = require('../../../server/Database')
const libraryItemsBookFilters = require('../../../server/utils/queries/libraryItemsBookFilters')

/**
 * Assert that `expanded` contains every key from `minified` with matching values.
 * Used to enforce the contract: toOldJSONExpanded() is a strict superset of toOldJSONMinified().
 *
 * @param {object} minified
 * @param {object} expanded
 * @param {string} [path]
 */
function assertExpandedSuperset(minified, expanded, path = '') {
  for (const key of Object.keys(minified)) {
    const keyPath = path ? `${path}.${key}` : key
    expect(expanded, `missing key ${keyPath}`).to.have.property(key)

    const minifiedValue = minified[key]
    const expandedValue = expanded[key]

    if (minifiedValue !== null && typeof minifiedValue === 'object' && !Array.isArray(minifiedValue)) {
      assertExpandedSuperset(minifiedValue, expandedValue, keyPath)
    } else if (Array.isArray(minifiedValue)) {
      expect(expandedValue, `expected array at ${keyPath}`).to.be.an('array')
      expect(expandedValue).to.deep.equal(minifiedValue)
    } else {
      expect(expandedValue, `value mismatch at ${keyPath}`).to.equal(minifiedValue)
    }
  }
}

describe('old JSON serialization', () => {
  let bookLibraryItemId
  let podcastLibraryItemId

  beforeEach(async () => {
    global.ServerSettings = {}
    Database.sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
    Database.sequelize.uppercaseFirst = (str) => (str ? `${str[0].toUpperCase()}${str.substr(1)}` : '')
    await Database.buildModels()

    const bookLibrary = await Database.libraryModel.create({ name: 'Book Library', mediaType: 'book' })
    const bookLibraryFolder = await Database.libraryFolderModel.create({ path: '/books', libraryId: bookLibrary.id })

    const book = await Database.bookModel.create({
      title: 'Test Book',
      audioFiles: [{ index: 1, ino: '1', metadata: { filename: 'track.mp3', ext: '.mp3', path: '/track.mp3', relPath: 'track.mp3', size: 1000 } }],
      tags: ['fiction'],
      narrators: ['Narrator One'],
      genres: ['Fantasy'],
      chapters: [{ id: 0, start: 0, end: 100, title: 'Chapter 1' }],
      ebookFile: { ino: '2', metadata: { filename: 'book.epub', ext: '.epub', path: '/book.epub', relPath: 'book.epub', size: 500 }, ebookFormat: 'epub' }
    })
    const bookLibraryItem = await Database.libraryItemModel.create({
      libraryFiles: [{ ino: '1', metadata: { filename: 'track.mp3', ext: '.mp3', path: '/track.mp3', relPath: 'track.mp3' } }],
      mediaId: book.id,
      mediaType: 'book',
      libraryId: bookLibrary.id,
      libraryFolderId: bookLibraryFolder.id
    })
    bookLibraryItemId = bookLibraryItem.id

    const author = await Database.authorModel.create({ name: 'Test Author', libraryId: bookLibrary.id })
    await Database.bookAuthorModel.create({ bookId: book.id, authorId: author.id })

    const series = await Database.seriesModel.create({ name: 'Test Series', libraryId: bookLibrary.id })
    await Database.bookSeriesModel.create({ bookId: book.id, seriesId: series.id, sequence: '2' })

    const podcastLibrary = await Database.libraryModel.create({ name: 'Podcast Library', mediaType: 'podcast' })
    const podcastLibraryFolder = await Database.libraryFolderModel.create({ path: '/podcasts', libraryId: podcastLibrary.id })

    const podcast = await Database.podcastModel.create({
      title: 'Test Podcast',
      tags: ['news'],
      genres: ['Technology'],
      autoDownloadEpisodes: false
    })
    const podcastLibraryItem = await Database.libraryItemModel.create({
      libraryFiles: [],
      mediaId: podcast.id,
      mediaType: 'podcast',
      libraryId: podcastLibrary.id,
      libraryFolderId: podcastLibraryFolder.id
    })
    podcastLibraryItemId = podcastLibraryItem.id

    await Database.podcastEpisodeModel.create({
      podcastId: podcast.id,
      title: 'Episode 1',
      index: 1,
      audioFile: { ino: '3', metadata: { filename: 'ep1.mp3', ext: '.mp3', path: '/ep1.mp3', relPath: 'ep1.mp3' } }
    })
  })

  afterEach(async () => {
    await Database.sequelize.sync({ force: true })
  })

  describe('Book', () => {
    it('toOldJSONExpanded is a strict superset of toOldJSONMinified', async () => {
      const libraryItem = await Database.libraryItemModel.getExpandedById(bookLibraryItemId)
      const minified = libraryItem.media.toOldJSONMinified()
      const expanded = libraryItem.media.toOldJSONExpanded(libraryItem.id)

      assertExpandedSuperset(minified, expanded)

      expect(expanded).to.have.property('libraryItemId', libraryItem.id)
      expect(expanded).to.have.property('audioFiles')
      expect(expanded).to.have.property('chapters')
      expect(expanded).to.have.property('tracks')
      expect(expanded.numTracks).to.equal(expanded.tracks.length)
      expect(expanded.numAudioFiles).to.equal(expanded.audioFiles.length)
      expect(expanded.numChapters).to.equal(expanded.chapters.length)
      expect(expanded.ebookFormat).to.equal('epub')
    })
  })

  describe('Podcast', () => {
    it('toOldJSONExpanded is a strict superset of toOldJSONMinified', async () => {
      const libraryItem = await Database.libraryItemModel.getExpandedById(podcastLibraryItemId)
      const minified = libraryItem.media.toOldJSONMinified()
      const expanded = libraryItem.media.toOldJSONExpanded(libraryItem.id)

      assertExpandedSuperset(minified, expanded)

      expect(expanded).to.have.property('libraryItemId', libraryItem.id)
      expect(expanded).to.have.property('episodes')
      expect(expanded.numEpisodes).to.equal(expanded.episodes.length)
    })
  })

  describe('LibraryItem', () => {
    it('book library item expanded is a strict superset of minified', async () => {
      const libraryItem = await Database.libraryItemModel.getExpandedById(bookLibraryItemId)
      const minified = libraryItem.toOldJSONMinified()
      const expanded = libraryItem.toOldJSONExpanded()

      assertExpandedSuperset(minified, expanded)

      expect(expanded).to.have.property('libraryFiles')
      expect(expanded).to.have.property('lastScan')
      expect(expanded.numFiles).to.equal(expanded.libraryFiles.length)
      expect(expanded.media.numTracks).to.equal(expanded.media.tracks.length)
    })

    it('podcast library item expanded is a strict superset of minified', async () => {
      const libraryItem = await Database.libraryItemModel.getExpandedById(podcastLibraryItemId)
      const minified = libraryItem.toOldJSONMinified()
      const expanded = libraryItem.toOldJSONExpanded()

      assertExpandedSuperset(minified, expanded)

      expect(expanded).to.have.property('libraryFiles')
      expect(expanded.media.numEpisodes).to.equal(expanded.media.episodes.length)
    })
  })

  describe('Books loaded without the large JSON columns', () => {
    const fileMetadata = (filename, size) => ({ filename, ext: '.mp3', path: `/${filename}`, relPath: filename, size })

    const include = (libraryItemAttributes) => [
      { model: Database.libraryItemModel, required: true, ...(libraryItemAttributes ? { attributes: libraryItemAttributes } : {}) },
      { model: Database.authorModel, through: { attributes: [] } },
      { model: Database.seriesModel, through: { attributes: ['id', 'sequence'] } }
    ]
    const toMinifiedJSON = (books) =>
      books.map((book) => {
        const libraryItem = book.libraryItem
        libraryItem.media = book
        return libraryItem.toOldJSONMinified()
      })
    const loadFull = async () => toMinifiedJSON(await Database.bookModel.findAll({ include: include(), order: [['title', 'ASC']] }))
    // The way libraryItemsBookFilters.getFilteredLibraryItems loads books
    const loadMinified = async () => {
      const books = await Database.bookModel.findAll({ attributes: { exclude: ['audioFiles', 'chapters'] }, include: include({ exclude: ['libraryFiles'] }), order: [['title', 'ASC']] })
      expect(books[0].audioFiles).to.be.undefined
      expect(books[0].libraryItem.libraryFiles).to.be.undefined
      await libraryItemsBookFilters.loadMinifiedStats(books)
      return toMinifiedJSON(books)
    }

    async function createBook(title, bookData, libraryFiles) {
      const library = await Database.libraryModel.findOne({ where: { mediaType: 'book' } })
      const folder = await Database.libraryFolderModel.findOne({ where: { libraryId: library.id } })
      const book = await Database.bookModel.create({ title, tags: [], narrators: [], genres: [], ...bookData })
      await Database.libraryItemModel.create({ libraryFiles, mediaId: book.id, mediaType: 'book', libraryId: library.id, libraryFolderId: folder.id })
      return book
    }

    it('toOldJSONMinified is the same as for fully loaded books', async () => {
      await createBook(
        'Excluded track',
        {
          audioFiles: [
            { index: 1, ino: '10', metadata: fileMetadata('a.mp3', 100) },
            { index: 2, ino: '11', exclude: true, metadata: fileMetadata('b.mp3', 250) }
          ],
          chapters: [
            { id: 0, start: 0, end: 10, title: 'One' },
            { id: 1, start: 10, end: 20, title: 'Two' }
          ]
        },
        [
          { ino: '10', metadata: fileMetadata('a.mp3', 100) },
          { ino: '11', metadata: fileMetadata('b.mp3', 250) },
          { ino: '12', metadata: fileMetadata('cover.jpg', 5) }
        ]
      )
      await createBook('Ebook only', { audioFiles: [], chapters: null, ebookFile: { ino: '20', ebookFormat: 'epub', metadata: fileMetadata('book.epub', 777) } }, [])
      // The size is NaN, which is null in the JSON response
      await createBook('Missing size', { audioFiles: [{ index: 1, ino: '30', metadata: { filename: 'c.mp3', path: '/c.mp3' } }], chapters: [] }, [])

      const full = await loadFull()
      const minified = await loadMinified()

      expect(minified).to.have.length(4)
      expect(JSON.stringify(minified)).to.equal(JSON.stringify(full))
      const excludedTrack = minified.find((li) => li.media.metadata.title === 'Excluded track')
      expect(excludedTrack.media).to.include({ numTracks: 1, numAudioFiles: 2, numChapters: 2, size: 350 })
      expect(excludedTrack.numFiles).to.equal(3)
    })

    it('toOldJSONMinified uses the new values after a book or its library item was updated', async () => {
      const book = await createBook('Changing', { audioFiles: [{ index: 1, ino: '40', metadata: fileMetadata('d.mp3', 10) }], chapters: [] }, [])
      await loadMinified()

      // updatedAt is what tells that the values in memory are outdated, set here because the test runs within a millisecond
      const updatedAt = new Date(Date.now() + 1000)
      const audioFiles = [...book.audioFiles, { index: 2, ino: '41', metadata: fileMetadata('e.mp3', 20) }]
      await Database.bookModel.update({ audioFiles, updatedAt }, { where: { id: book.id }, silent: true })
      await Database.libraryItemModel.update({ libraryFiles: [{ ino: '40', metadata: fileMetadata('d.mp3', 10) }], updatedAt }, { where: { mediaId: book.id }, silent: true })

      const minified = await loadMinified()

      expect(JSON.stringify(minified)).to.equal(JSON.stringify(await loadFull()))
      const changing = minified.find((li) => li.media.metadata.title === 'Changing')
      expect(changing.media).to.include({ numTracks: 2, numAudioFiles: 2, size: 30 })
      expect(changing.numFiles).to.equal(1)
    })
  })
})
