const { expect } = require('chai')
const { Sequelize } = require('sequelize')
const sinon = require('sinon')

const Database = require('../../../server/Database')
const Logger = require('../../../server/Logger')

describe('LibraryItem', () => {
  let library
  let libraryFolder

  beforeEach(async () => {
    global.ServerSettings = {}
    Database.sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
    Database.sequelize.uppercaseFirst = (str) => (str ? `${str[0].toUpperCase()}${str.substr(1)}` : '')
    await Database.buildModels()

    library = await Database.libraryModel.create({ name: 'Book Library', mediaType: 'book' })
    libraryFolder = await Database.libraryFolderModel.create({ path: '/books', libraryId: library.id })

    sinon.stub(Logger, 'error')
  })

  afterEach(async () => {
    sinon.restore()
    await Database.sequelize.sync({ force: true })
  })

  async function createBookLibraryItem(title) {
    const book = await Database.bookModel.create({ title, audioFiles: [], tags: [], narrators: [], genres: [], chapters: [] })
    const libraryItem = await Database.libraryItemModel.create({ libraryFiles: [], mediaId: book.id, mediaType: 'book', libraryId: library.id, libraryFolderId: libraryFolder.id })
    return { book, libraryItem }
  }

  describe('getExpandedById', () => {
    it('should load a book with its authors and series', async () => {
      const { book, libraryItem } = await createBookLibraryItem('Book')
      const other = await createBookLibraryItem('Other Book')
      const author = await Database.authorModel.create({ name: 'Author', libraryId: library.id })
      const otherAuthor = await Database.authorModel.create({ name: 'Other Author', libraryId: library.id })
      await Database.bookAuthorModel.create({ bookId: book.id, authorId: author.id })
      await Database.bookAuthorModel.create({ bookId: other.book.id, authorId: otherAuthor.id })
      const series = await Database.seriesModel.create({ name: 'Series', libraryId: library.id })
      const bookSeries = await Database.bookSeriesModel.create({ bookId: book.id, seriesId: series.id, sequence: '3' })

      const expanded = await Database.libraryItemModel.getExpandedById(libraryItem.id)

      expect(expanded.media.id).to.equal(book.id)
      expect(expanded.media.authors.map((au) => au.name)).to.deep.equal(['Author'])
      expect(expanded.media.series.map((se) => se.name)).to.deep.equal(['Series'])
      expect(expanded.media.series[0].bookSeries.id).to.equal(bookSeries.id)
      expect(expanded.media.series[0].bookSeries.sequence).to.equal('3')
      expect(() => expanded.toOldJSONExpanded()).to.not.throw()
    })

    it('should order authors and series by the time they were added to the book', async () => {
      const { book, libraryItem } = await createBookLibraryItem('Book')
      const addedLast = await Database.authorModel.create({ name: 'Added Last', libraryId: library.id })
      const addedFirst = await Database.authorModel.create({ name: 'Added First', libraryId: library.id })
      await Database.bookAuthorModel.create({ bookId: book.id, authorId: addedLast.id, createdAt: new Date('2024-01-02T00:00:00Z') })
      await Database.bookAuthorModel.create({ bookId: book.id, authorId: addedFirst.id, createdAt: new Date('2024-01-01T00:00:00Z') })
      const seriesAddedLast = await Database.seriesModel.create({ name: 'Series Added Last', libraryId: library.id })
      const seriesAddedFirst = await Database.seriesModel.create({ name: 'Series Added First', libraryId: library.id })
      await Database.bookSeriesModel.create({ bookId: book.id, seriesId: seriesAddedLast.id, sequence: '1', createdAt: new Date('2024-01-02T00:00:00Z') })
      await Database.bookSeriesModel.create({ bookId: book.id, seriesId: seriesAddedFirst.id, sequence: '2', createdAt: new Date('2024-01-01T00:00:00Z') })

      const expanded = await Database.libraryItemModel.getExpandedById(libraryItem.id)

      expect(expanded.media.authorName).to.equal('Added First, Added Last')
      expect(expanded.media.seriesName).to.equal('Series Added First #2, Series Added Last #1')
    })

    it('should keep the order of authors and series that were added at the same time', async () => {
      // The scanner adds all authors and series of a book at the same time
      const { book, libraryItem } = await createBookLibraryItem('Book')
      const sameTime = new Date('2024-01-01T00:00:00Z')
      // Authors are returned in the order they were created, series in the order of the bookSeries ids
      const authorIds = ['ffffffff-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003']
      for (const [index, id] of authorIds.entries()) {
        await Database.authorModel.create({ id, name: `Author ${index + 1}`, libraryId: library.id })
      }
      for (const id of [authorIds[1], authorIds[2], authorIds[0]]) {
        await Database.bookAuthorModel.create({ bookId: book.id, authorId: id, createdAt: sameTime })
      }
      const bookSeriesIds = ['cccccccc-2222-4000-8000-000000000001', 'aaaaaaaa-2222-4000-8000-000000000002', 'bbbbbbbb-2222-4000-8000-000000000003']
      for (const [index, id] of bookSeriesIds.entries()) {
        const series = await Database.seriesModel.create({ name: `Series ${index + 1}`, libraryId: library.id })
        await Database.bookSeriesModel.create({ id, bookId: book.id, seriesId: series.id, sequence: `${index + 1}`, createdAt: sameTime })
      }

      const expanded = await Database.libraryItemModel.getExpandedById(libraryItem.id)

      expect(expanded.media.authorName).to.equal('Author 1, Author 2, Author 3')
      expect(expanded.media.seriesName).to.equal('Series 2 #2, Series 3 #3, Series 1 #1')
    })

    it('should load a podcast with its episodes', async () => {
      const podcastLibrary = await Database.libraryModel.create({ name: 'Podcasts', mediaType: 'podcast' })
      const podcastFolder = await Database.libraryFolderModel.create({ path: '/podcasts', libraryId: podcastLibrary.id })
      const podcast = await Database.podcastModel.create({ title: 'Podcast', tags: [], genres: [], autoDownloadEpisodes: false })
      const libraryItem = await Database.libraryItemModel.create({ libraryFiles: [], mediaId: podcast.id, mediaType: 'podcast', libraryId: podcastLibrary.id, libraryFolderId: podcastFolder.id })
      await Database.podcastEpisodeModel.create({ podcastId: podcast.id, title: 'Episode 1', index: 1, audioFile: { ino: '1', metadata: { filename: 'ep1.mp3', ext: '.mp3', path: '/ep1.mp3', relPath: 'ep1.mp3' } } })

      const expanded = await Database.libraryItemModel.getExpandedById(libraryItem.id)

      expect(expanded.media.id).to.equal(podcast.id)
      expect(expanded.media.podcastEpisodes.map((ep) => ep.title)).to.deep.equal(['Episode 1'])
    })

    it('should return null when the library item does not exist', async () => {
      expect(await Database.libraryItemModel.getExpandedById('00000000-0000-4000-8000-000000000000')).to.be.null
    })
  })
})
