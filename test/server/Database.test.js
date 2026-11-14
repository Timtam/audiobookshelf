const { expect } = require('chai')
const sinon = require('sinon')
const sqlite3 = require('sqlite3')
const Path = require('path')
const os = require('os')
const nodeFs = require('fs')

const fs = require('../../server/libs/fsExtra')
const Logger = require('../../server/Logger')
const Database = require('../../server/Database')
const MigrationManager = require('../../server/managers/MigrationManager')

describe('Database', () => {
  let tempDir = null
  let originalConfigPath = null

  const getPragma = async (name, queryOptions = {}) => {
    const [[result]] = await Database.sequelize.query(`PRAGMA ${name}`, { ...queryOptions })
    return result[name]
  }

  beforeEach(() => {
    tempDir = nodeFs.mkdtempSync(Path.join(os.tmpdir(), 'abs-database-test-'))
    originalConfigPath = global.ConfigPath
    global.ConfigPath = tempDir
    Database.dbPath = Path.join(tempDir, 'absdatabase.sqlite')

    sinon.stub(Logger, 'info')
    sinon.stub(Logger, 'debug')
  })

  afterEach(async () => {
    sinon.restore()
    global.ConfigPath = originalConfigPath
    delete process.env.SQLITE_JOURNAL_MODE
    delete process.env.SQLITE_CACHE_SIZE

    await Database.sequelize.close()
    Database.readQueryOptions = {}
    await fs.remove(tempDir)
  })

  describe('connect', () => {
    it('should use WAL mode with synchronous NORMAL', async () => {
      expect(await Database.connect()).to.be.true

      expect(await getPragma('journal_mode')).to.equal('wal')
      expect(await getPragma('synchronous')).to.equal(1)
    })

    it('should use the journal mode of the SQLITE_JOURNAL_MODE env variable', async () => {
      process.env.SQLITE_JOURNAL_MODE = 'DELETE'

      await Database.connect()
      await Database.openReadConnection()

      expect(await getPragma('journal_mode')).to.equal('delete')
      // Without WAL mode a second connection would block writes while it reads
      expect(Database.readQueryOptions).to.deep.equal({})
    })

    it('should run the statements of each connection one after another', async () => {
      const serializeSpy = sinon.spy(sqlite3.Database.prototype, 'serialize')

      await Database.connect()
      await Database.openReadConnection()

      // Without a callback the connection stays in serialize mode, statements that overlap on a connection block the event loop
      expect(serializeSpy.getCalls().filter((call) => !call.args.length)).to.have.length(2)
    })
  })

  describe('openReadConnection', () => {
    it('should open a second connection for queries with readQueryOptions', async () => {
      process.env.SQLITE_CACHE_SIZE = '-4000'
      await Database.connect()
      expect(Database.readQueryOptions).to.deep.equal({})

      await Database.openReadConnection()

      expect(Database.readQueryOptions).to.deep.equal({ uuid: 'read' })
      expect(Object.keys(Database.sequelize.connectionManager.connections)).to.have.members(['default', 'read'])
      expect(await getPragma('cache_size', Database.readQueryOptions)).to.equal(-4000)
    })
  })

  describe('init', () => {
    it('should open the read connection after ANALYZE', async () => {
      // A connection only loads the table statistics once. With other statistics a query can return rows with equal sort keys in another order
      sinon.stub(MigrationManager.prototype, 'init').resolves()
      sinon.stub(MigrationManager.prototype, 'runMigrations').resolves()
      sinon.stub(Database, 'buildModels').resolves()
      sinon.stub(Database, 'addTriggers').resolves()
      sinon.stub(Database, 'loadData').resolves()
      const openReadConnectionStub = sinon.stub(Database, 'openReadConnection').resolves()
      const connect = Database.connect.bind(Database)
      let querySpy = null
      sinon.stub(Database, 'connect').callsFake(async () => {
        const isConnected = await connect()
        querySpy = sinon.spy(Database.sequelize, 'query')
        return isConnected
      })

      await Database.init()

      expect(openReadConnectionStub.calledOnce).to.be.true
      expect(querySpy.withArgs('ANALYZE').calledBefore(openReadConnectionStub)).to.be.true
    })
  })
})
