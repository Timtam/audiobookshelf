const { Request, Response, NextFunction } = require('express')
const uuidv4 = require('uuid').v4
const Logger = require('../Logger')
const SocketAuthority = require('../SocketAuthority')
const Database = require('../Database')

const User = require('../objects/user/User')

const { toNumber } = require('../utils/index')

/**
 * @typedef RequestUserObject
 * @property {import('../models/User')} user
 *
 * @typedef {Request & RequestUserObject} RequestWithUser
 *
 * @typedef RequestEntityObject
 * @property {import('../models/User')} reqUser
 *
 * @typedef {RequestWithUser & RequestEntityObject} UserControllerRequest
 */

class UserController {
  constructor() {}

  /**
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async findAll(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    const hideRootToken = !req.user.isRoot

    const includes = (req.query.include || '').split(',').map((i) => i.trim())

    // Minimal toJSONForBrowser does not include mediaProgress and bookmarks
    const allUsers = await Database.userModel.findAll()
    const users = allUsers.map((u) => u.toOldJSONForBrowser(hideRootToken, true))

    if (includes.includes('latestSession')) {
      for (const user of users) {
        const userSessions = await Database.getPlaybackSessions({ userId: user.id })
        user.latestSession = userSessions.sort((a, b) => b.updatedAt - a.updatedAt).shift() || null
      }
    }

    res.json({
      users
    })
  }

  /**
   * GET: /api/users/:id
   * Get a single user toJSONForBrowser
   * Media progress items include: `displayTitle`, `displaySubtitle` (for podcasts), `coverPath` and `mediaUpdatedAt`
   *
   * @param {UserControllerRequest} req
   * @param {Response} res
   */
  async findOne(req, res) {
    if (!req.user.isAdminOrUp) {
      Logger.error(`Non-admin user "${req.user.username}" attempted to get user`)
      return res.sendStatus(403)
    }

    // Get user media progress with associated mediaItem
    const mediaProgresses = await Database.mediaProgressModel.findAll({
      where: {
        userId: req.reqUser.id
      },
      include: [
        {
          model: Database.bookModel,
          attributes: ['id', 'title', 'coverPath', 'updatedAt']
        },
        {
          model: Database.podcastEpisodeModel,
          attributes: ['id', 'title'],
          include: {
            model: Database.podcastModel,
            attributes: ['id', 'title', 'coverPath', 'updatedAt']
          }
        }
      ]
    })

    const oldMediaProgresses = mediaProgresses.map((mp) => {
      const oldMediaProgress = mp.getOldMediaProgress()
      oldMediaProgress.displayTitle = mp.mediaItem?.title
      if (mp.mediaItem?.podcast) {
        oldMediaProgress.displaySubtitle = mp.mediaItem.podcast?.title
        oldMediaProgress.coverPath = mp.mediaItem.podcast?.coverPath
        oldMediaProgress.mediaUpdatedAt = mp.mediaItem.podcast?.updatedAt
      } else if (mp.mediaItem) {
        oldMediaProgress.coverPath = mp.mediaItem.coverPath
        oldMediaProgress.mediaUpdatedAt = mp.mediaItem.updatedAt
      }
      return oldMediaProgress
    })

    const userJson = req.reqUser.toOldJSONForBrowser(!req.user.isRoot)

    userJson.mediaProgress = oldMediaProgresses

    res.json(userJson)
  }

  /**
   * POST: /api/users
   * Create a new user
   *
   * @this {import('../routers/ApiRouter')}
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async create(req, res) {
    const account = req.body
    const username = account.username

    const usernameExists = await Database.userModel.checkUserExistsWithUsername(username)
    if (usernameExists) {
      return res.status(400).send('Username already taken')
    }

    account.id = uuidv4()
    account.pash = await this.auth.hashPass(account.password)
    delete account.password
    account.token = await this.auth.generateAccessToken(account)
    account.createdAt = Date.now()
    const newUser = new User(account)

    // TODO: Create with new User model
    const success = await Database.createUser(newUser)
    if (success) {
      SocketAuthority.adminEmitter('user_added', newUser.toJSONForBrowser())
      res.json({
        user: newUser.toJSONForBrowser()
      })
    } else {
      return res.status(500).send('Failed to save new user')
    }
  }

  /**
   * PATCH: /api/users/:id
   * Update user
   *
   * @this {import('../routers/ApiRouter')}
   *
   * @param {UserControllerRequest} req
   * @param {Response} res
   */
  async update(req, res) {
    const user = req.reqUser

    if (user.type === 'root' && !req.user.isRoot) {
      Logger.error(`[UserController] Admin user "${req.user.username}" attempted to update root user`)
      return res.sendStatus(403)
    }

    const updatePayload = req.body
    let shouldUpdateToken = false

    // When changing username create a new API token
    if (updatePayload.username !== undefined && updatePayload.username !== user.username) {
      const usernameExists = await Database.userModel.checkUserExistsWithUsername(updatePayload.username)
      if (usernameExists) {
        return res.status(500).send('Username already taken')
      }
      shouldUpdateToken = true
    }

    // Updating password
    if (updatePayload.password) {
      updatePayload.pash = await this.auth.hashPass(updatePayload.password)
      delete updatePayload.password
    }

    // TODO: Update with new User model
    const oldUser = Database.userModel.getOldUser(user)
    if (oldUser.update(updatePayload)) {
      if (shouldUpdateToken) {
        oldUser.token = await this.auth.generateAccessToken(oldUser)
        Logger.info(`[UserController] User ${oldUser.username} has generated a new api token`)
      }
      await Database.updateUser(oldUser)
      SocketAuthority.clientEmitter(req.user.id, 'user_updated', oldUser.toJSONForBrowser())
    }

    res.json({
      success: true,
      user: oldUser.toJSONForBrowser()
    })
  }

  /**
   * DELETE: /api/users/:id
   * Delete a user
   *
   * @param {UserControllerRequest} req
   * @param {Response} res
   */
  async delete(req, res) {
    if (req.params.id === 'root') {
      Logger.error('[UserController] Attempt to delete root user. Root user cannot be deleted')
      return res.sendStatus(400)
    }
    if (req.user.id === req.params.id) {
      Logger.error(`[UserController] User ${req.user.username} is attempting to delete self`)
      return res.sendStatus(400)
    }
    const user = req.reqUser

    // Todo: check if user is logged in and cancel streams

    // Remove user playlists
    const userPlaylists = await Database.playlistModel.findAll({
      where: {
        userId: user.id
      }
    })
    for (const playlist of userPlaylists) {
      await playlist.destroy()
    }

    const userJson = user.toOldJSONForBrowser()
    await user.destroy()
    SocketAuthority.adminEmitter('user_removed', userJson)
    res.json({
      success: true
    })
  }

  /**
   * PATCH: /api/users/:id/openid-unlink
   *
   * @param {UserControllerRequest} req
   * @param {Response} res
   */
  async unlinkFromOpenID(req, res) {
    Logger.debug(`[UserController] Unlinking user "${req.reqUser.username}" from OpenID with sub "${req.reqUser.authOpenIDSub}"`)

    if (!req.reqUser.authOpenIDSub) {
      return res.sendStatus(200)
    }

    req.reqUser.extraData.authOpenIDSub = null
    req.reqUser.changed('extraData', true)
    await req.reqUser.save()
    SocketAuthority.clientEmitter(req.user.id, 'user_updated', req.reqUser.toOldJSONForBrowser())
    res.sendStatus(200)
  }

  /**
   * GET: /api/users/:id/listening-sessions
   *
   * @param {UserControllerRequest} req
   * @param {Response} res
   */
  async getListeningSessions(req, res) {
    var listeningSessions = await this.getUserListeningSessionsHelper(req.params.id)

    const itemsPerPage = toNumber(req.query.itemsPerPage, 10) || 10
    const page = toNumber(req.query.page, 0)

    const start = page * itemsPerPage
    const sessions = listeningSessions.slice(start, start + itemsPerPage)

    const payload = {
      total: listeningSessions.length,
      numPages: Math.ceil(listeningSessions.length / itemsPerPage),
      page,
      itemsPerPage,
      sessions
    }

    res.json(payload)
  }

  /**
   * GET: /api/users/:id/listening-stats
   *
   * @this {import('../routers/ApiRouter')}
   *
   * @param {UserControllerRequest} req
   * @param {Response} res
   */
  async getListeningStats(req, res) {
    var listeningStats = await this.getUserListeningStatsHelpers(req.params.id)
    res.json(listeningStats)
  }

  /**
   * GET: /api/users/online
   *
   * @this {import('../routers/ApiRouter')}
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async getOnlineUsers(req, res) {
    if (!req.user.isAdminOrUp) {
      return res.sendStatus(403)
    }

    res.json({
      usersOnline: SocketAuthority.getUsersOnline(),
      openSessions: this.playbackSessionManager.sessions
    })
  }

  /**
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   * @param {NextFunction} next
   */
  async middleware(req, res, next) {
    if (!req.user.isAdminOrUp && req.user.id !== req.params.id) {
      return res.sendStatus(403)
    } else if ((req.method == 'PATCH' || req.method == 'POST' || req.method == 'DELETE') && !req.user.isAdminOrUp) {
      return res.sendStatus(403)
    }

    if (req.params.id) {
      req.reqUser = await Database.userModel.getUserById(req.params.id)
      if (!req.reqUser) {
        return res.sendStatus(404)
      }
    }

    next()
  }
}
module.exports = new UserController()
