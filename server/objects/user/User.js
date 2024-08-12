const AudioBookmark = require('./AudioBookmark')
const MediaProgress = require('./MediaProgress')

class User {
  constructor(user) {
    this.id = null
    this.oldUserId = null // TODO: Temp for keeping old access tokens
    this.username = null
    this.email = null
    this.pash = null
    this.type = null
    this.token = null
    this.isActive = true
    this.isLocked = false
    this.lastSeen = null
    this.createdAt = null

    this.mediaProgress = []
    this.seriesHideFromContinueListening = [] // Series IDs that should not show on home page continue listening
    this.bookmarks = []

    this.permissions = {}
    this.librariesAccessible = [] // Library IDs (Empty if ALL libraries)
    this.itemTagsSelected = [] // Empty if ALL item tags accessible

    this.authOpenIDSub = null

    if (user) {
      this.construct(user)
    }
  }

  get isRoot() {
    return this.type === 'root'
  }
  get isAdmin() {
    return this.type === 'admin'
  }
  get isUser() {
    return this.type === 'user'
  }
  get isGuest() {
    return this.type === 'guest'
  }
  get isAdminOrUp() {
    return this.isAdmin || this.isRoot
  }
  get canDelete() {
    return !!this.permissions.delete && this.isActive
  }
  get canUpdate() {
    return !!this.permissions.update && this.isActive
  }
  get canDownload() {
    return !!this.permissions.download && this.isActive
  }
  get canUpload() {
    return !!this.permissions.upload && this.isActive
  }
  get canAccessExplicitContent() {
    return !!this.permissions.accessExplicitContent && this.isActive
  }
  get hasPw() {
    return !!this.pash && !!this.pash.length
  }

  getDefaultUserPermissions() {
    return {
      download: true,
      update: this.type === 'root' || this.type === 'admin',
      delete: this.type === 'root',
      upload: this.type === 'root' || this.type === 'admin',
      accessAllLibraries: true,
      accessAllTags: true,
      accessExplicitContent: true
    }
  }

  toJSON() {
    return {
      id: this.id,
      oldUserId: this.oldUserId,
      username: this.username,
      email: this.email,
      pash: this.pash,
      type: this.type,
      token: this.token,
      mediaProgress: this.mediaProgress ? this.mediaProgress.map((li) => li.toJSON()) : [],
      seriesHideFromContinueListening: [...this.seriesHideFromContinueListening],
      bookmarks: this.bookmarks ? this.bookmarks.map((b) => b.toJSON()) : [],
      isActive: this.isActive,
      isLocked: this.isLocked,
      lastSeen: this.lastSeen,
      createdAt: this.createdAt,
      permissions: this.permissions,
      librariesAccessible: [...this.librariesAccessible],
      itemTagsSelected: [...this.itemTagsSelected],
      authOpenIDSub: this.authOpenIDSub
    }
  }

  toJSONForBrowser(hideRootToken = false, minimal = false) {
    const json = {
      id: this.id,
      oldUserId: this.oldUserId,
      username: this.username,
      email: this.email,
      type: this.type,
      token: this.type === 'root' && hideRootToken ? '' : this.token,
      mediaProgress: this.mediaProgress ? this.mediaProgress.map((li) => li.toJSON()) : [],
      seriesHideFromContinueListening: [...this.seriesHideFromContinueListening],
      bookmarks: this.bookmarks ? this.bookmarks.map((b) => b.toJSON()) : [],
      isActive: this.isActive,
      isLocked: this.isLocked,
      lastSeen: this.lastSeen,
      createdAt: this.createdAt,
      permissions: this.permissions,
      librariesAccessible: [...this.librariesAccessible],
      itemTagsSelected: [...this.itemTagsSelected],
      hasOpenIDLink: !!this.authOpenIDSub
    }
    if (minimal) {
      delete json.mediaProgress
      delete json.bookmarks
    }
    return json
  }

  /**
   * User data for clients
   * @param {[oldPlaybackSession[]]} sessions optional array of open playback sessions
   * @returns {object}
   */
  toJSONForPublic(sessions) {
    const userSession = sessions?.find((s) => s.userId === this.id) || null
    const session = userSession?.toJSONForClient() || null
    return {
      id: this.id,
      oldUserId: this.oldUserId,
      username: this.username,
      type: this.type,
      session,
      lastSeen: this.lastSeen,
      createdAt: this.createdAt
    }
  }

  construct(user) {
    this.id = user.id
    this.oldUserId = user.oldUserId
    this.username = user.username
    this.email = user.email || null
    this.pash = user.pash
    this.type = user.type
    this.token = user.token

    this.mediaProgress = []
    if (user.mediaProgress) {
      this.mediaProgress = user.mediaProgress.map((li) => new MediaProgress(li)).filter((lip) => lip.id)
    }

    this.bookmarks = []
    if (user.bookmarks) {
      this.bookmarks = user.bookmarks.filter((bm) => typeof bm.libraryItemId == 'string').map((bm) => new AudioBookmark(bm))
    }

    this.seriesHideFromContinueListening = []
    if (user.seriesHideFromContinueListening) this.seriesHideFromContinueListening = [...user.seriesHideFromContinueListening]

    this.isActive = user.isActive === undefined || user.type === 'root' ? true : !!user.isActive
    this.isLocked = user.type === 'root' ? false : !!user.isLocked
    this.lastSeen = user.lastSeen || null
    this.createdAt = user.createdAt || Date.now()
    this.permissions = user.permissions || this.getDefaultUserPermissions()
    // Upload permission added v1.1.13, make sure root user has upload permissions
    if (this.type === 'root' && !this.permissions.upload) this.permissions.upload = true

    // Library restriction permissions added v1.4.14, defaults to all libraries
    if (this.permissions.accessAllLibraries === undefined) this.permissions.accessAllLibraries = true
    // Library restriction permissions added v2.0, defaults to all libraries
    if (this.permissions.accessAllTags === undefined) this.permissions.accessAllTags = true
    // Explicit content restriction permission added v2.0.18
    if (this.permissions.accessExplicitContent === undefined) this.permissions.accessExplicitContent = true
    // itemTagsAccessible was renamed to itemTagsSelected in version v2.2.20
    if (user.itemTagsAccessible?.length) {
      this.permissions.selectedTagsNotAccessible = false
      user.itemTagsSelected = user.itemTagsAccessible
    }

    this.librariesAccessible = [...(user.librariesAccessible || [])]
    this.itemTagsSelected = [...(user.itemTagsSelected || [])]

    this.authOpenIDSub = user.authOpenIDSub || null
  }

  update(payload) {
    var hasUpdates = false
    // Update the following keys:
    const keysToCheck = ['pash', 'type', 'username', 'email', 'isActive']
    keysToCheck.forEach((key) => {
      if (payload[key] !== undefined) {
        if (key === 'isActive' || payload[key]) {
          // pash, type, username must evaluate to true (cannot be null or empty)
          if (payload[key] !== this[key]) {
            hasUpdates = true
            this[key] = payload[key]
          }
        }
      }
    })

    if (payload.seriesHideFromContinueListening && Array.isArray(payload.seriesHideFromContinueListening)) {
      if (this.seriesHideFromContinueListening.join(',') !== payload.seriesHideFromContinueListening.join(',')) {
        hasUpdates = true
        this.seriesHideFromContinueListening = [...payload.seriesHideFromContinueListening]
      }
    }

    // And update permissions
    if (payload.permissions) {
      for (const key in payload.permissions) {
        if (payload.permissions[key] !== this.permissions[key]) {
          hasUpdates = true
          this.permissions[key] = payload.permissions[key]
        }
      }
    }

    // Update accessible libraries
    if (this.permissions.accessAllLibraries) {
      // Access all libraries
      if (this.librariesAccessible.length) {
        this.librariesAccessible = []
        hasUpdates = true
      }
    } else if (payload.librariesAccessible !== undefined) {
      if (payload.librariesAccessible.length) {
        if (payload.librariesAccessible.join(',') !== this.librariesAccessible.join(',')) {
          hasUpdates = true
          this.librariesAccessible = [...payload.librariesAccessible]
        }
      } else if (this.librariesAccessible.length > 0) {
        hasUpdates = true
        this.librariesAccessible = []
      }
    }

    // Update accessible tags
    if (this.permissions.accessAllTags) {
      // Access all tags
      if (this.itemTagsSelected.length) {
        this.itemTagsSelected = []
        this.permissions.selectedTagsNotAccessible = false
        hasUpdates = true
      }
    } else if (payload.itemTagsSelected !== undefined) {
      if (payload.itemTagsSelected.length) {
        if (payload.itemTagsSelected.join(',') !== this.itemTagsSelected.join(',')) {
          hasUpdates = true
          this.itemTagsSelected = [...payload.itemTagsSelected]
        }
      } else if (this.itemTagsSelected.length > 0) {
        hasUpdates = true
        this.itemTagsSelected = []
        this.permissions.selectedTagsNotAccessible = false
      }
    }
    return hasUpdates
  }
}
module.exports = User
