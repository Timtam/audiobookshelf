<template>
  <div class="page" :class="libraryItemIdStreaming ? 'streaming' : ''">
    <app-book-shelf-toolbar page="recent-episodes" />

    <div id="bookshelf" class="w-full overflow-y-auto px-2 py-6 sm:px-4 md:p-12 relative">
      <div class="w-full max-w-3xl mx-auto py-4">
        <p class="text-xl mb-2 font-semibold px-4 md:px-0" role="heading" aria-level="2">{{ $strings.HeaderLatestEpisodes }}</p>
        <p v-if="!recentEpisodes.length && !processing" class="text-center text-xl">{{ $strings.MessageNoEpisodes }}</p>
        <template v-for="(episode, index) in episodesMapped">
          <div :key="episode.id" class="flex py-5 cursor-pointer relative" @click.stop="clickEpisode(episode)">
            <covers-preview-cover :src="$store.getters['globals/getLibraryItemCoverSrcById'](episode.libraryItemId, episode.updatedAt)" :width="96" :book-cover-aspect-ratio="bookCoverAspectRatio" :show-resolution="false" class="hidden md:block" />
            <div class="grow pl-4 max-w-2xl">
              <!-- mobile -->
              <div class="flex md:hidden mb-2">
                <covers-preview-cover :src="$store.getters['globals/getLibraryItemCoverSrcById'](episode.libraryItemId, episode.updatedAt)" :width="48" :book-cover-aspect-ratio="bookCoverAspectRatio" :show-resolution="false" class="md:hidden" />
                <div class="grow px-2">
                  <div class="flex items-center" role="heading" aria-level="3">
                    <div class="flex" @click.stop>
                      <nuxt-link :to="`/item/${episode.libraryItemId}`" class="text-sm text-gray-200 hover:underline" :aria-label="episode.title + ' - ' + episode.podcast.metadata.title">{{ episode.podcast.metadata.title }}</nuxt-link>
                    </div>
                    <widgets-explicit-indicator v-if="episode.podcast.metadata.explicit" />
                  </div>
                  <p class="text-xs text-gray-300 mb-1">{{ $dateDistanceFromNow(episode.publishedAt) }}</p>
                </div>
              </div>
              <!-- desktop -->
              <div class="hidden md:block">
                <div class="flex items-center" role="heading" aria-level="3">
                  <div class="flex" @click.stop>
                    <nuxt-link :to="`/item/${episode.libraryItemId}`" class="text-sm text-gray-200 hover:underline" :aria-label="episode.title + ' - ' + episode.podcast.metadata.title">{{ episode.podcast.metadata.title }}</nuxt-link>
                  </div>
                  <widgets-explicit-indicator v-if="episode.podcast.metadata.explicit" />
                </div>
                <p class="text-xs text-gray-300 mb-1">{{ $dateDistanceFromNow(episode.publishedAt) }}</p>
              </div>

              <div class="flex items-center font-semibold text-gray-200">
                <p v-if="episode.season || episode.episode" class="sr-only">{{ (episode.season ? $getString('LabelSeasonNumber', [episode.season]) + ', ' : '') + (episode.episode ? $getString('LabelEpisodeNumber', [episode.episode]) : '')}}</p>
                <div v-if="episode.season || episode.episode" aria-hidden="true">#</div>
                <div v-if="episode.season" aria-hidden="true">{{ episode.season }}x</div>
                <div v-if="episode.episode" aria-hidden="true">{{ episode.episode }}</div>
              </div>

              <div dir="auto" class="flex items-center mb-2">
                <div class="font-semibold text-sm md:text-base" aria-hidden="true">{{ episode.title }}</div>
                <widgets-podcast-type-indicator :type="episode.episodeType" />
              </div>

              <p dir="auto" class="text-sm text-gray-200 mb-4 line-clamp-4" v-html="episode.subtitle || episode.description" />

              <div class="flex items-center">
                <button class="h-8 px-4 border border-white/20 hover:bg-white/10 rounded-full flex items-center justify-center cursor-pointer focus:outline-hidden" :class="episode.progress?.isFinished ? 'text-white/40' : ''" @click.stop="playClick(episode)" :aria-label="episodeIdStreaming === episode.id ? streamIsPlaying ? $strings.ButtonPause : $strings.ButtonPlay : ($strings.ButtonPlay + ' (' + getButtonText(episode) + ')')">
                  <span v-if="episodeIdStreaming === episode.id" class="material-symbols text-2xl" :class="streamIsPlaying ? '' : 'text-success'" aria-hidden="true">{{ streamIsPlaying ? 'pause' : 'play_arrow' }}</span>
                  <span v-else class="material-symbols fill text-2xl text-success" aria-hidden="true">play_arrow</span>
                  <p class="pl-2 pr-1 text-sm font-semibold" aria-hidden="true">{{ getButtonText(episode) }}</p>
                </button>

                <ui-tooltip v-if="libraryItemIdStreaming && !isStreamingFromDifferentLibrary" :text="playerQueueEpisodeIdMap[episode.id] ? $strings.MessageRemoveFromPlayerQueue : $strings.MessageAddToPlayerQueue" :class="playerQueueEpisodeIdMap[episode.id] ? 'text-success' : ''" direction="top">
                  <ui-icon-btn :icon="playerQueueEpisodeIdMap[episode.id] ? 'playlist_add_check' : 'playlist_play'" borderless @click="queueBtnClick(episode)" :text="playerQueueEpisodeIdMap[episode.id] ? $strings.MessageRemoveFromPlayerQueue : $strings.MessageAddToPlayerQueue" />
                </ui-tooltip>

                <ui-tooltip :text="!!episode.progress?.isFinished ? $strings.MessageMarkAsNotFinished : $strings.MessageMarkAsFinished" direction="top">
                  <ui-read-icon-btn :disabled="episodesProcessingMap[episode.id]" :is-read="!!episode.progress?.isFinished" borderless class="mx-1 mt-0.5" @click="toggleEpisodeFinished(episode)" :text="!!episode.progress?.isFinished ? $strings.MessageMarkAsNotFinished : $strings.MessageMarkAsFinished" />
                </ui-tooltip>

                <ui-tooltip :text="$strings.LabelYourPlaylists" direction="top">
                  <ui-icon-btn icon="playlist_add" borderless @click="clickAddToPlaylist(episode)" :text="$strings.LabelYourPlaylists" />
                </ui-tooltip>
              </div>
            </div>

            <div v-if="episode.progress" class="absolute bottom-0 left-0 h-0.5 pointer-events-none bg-warning" :style="{ width: episode.progress.progress * 100 + '%' }" />
          </div>
          <div :key="index" v-if="index !== recentEpisodes.length" class="w-full h-px bg-white/10" />
        </template>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  async asyncData({ params, query, store, app, redirect }) {
    var libraryId = params.library
    var libraryData = await store.dispatch('libraries/fetch', libraryId)
    if (!libraryData) {
      return redirect('/oops?message=Library not found')
    }

    // Redirect book libraries
    const library = libraryData.library
    if (library.mediaType === 'book') {
      return redirect(`/library/${libraryId}`)
    }

    return {
      libraryId
    }
  },
  data() {
    return {
      recentEpisodes: [],
      episodesProcessingMap: {},
      totalEpisodes: 0,
      currentPage: 0,
      processing: false,
      openingItem: false
    }
  },
  computed: {
    bookCoverAspectRatio() {
      return this.$store.getters['libraries/getBookCoverAspectRatio']
    },
    libraryItemIdStreaming() {
      return this.$store.getters['getLibraryItemIdStreaming']
    },
    episodeIdStreaming() {
      return this.$store.state.streamEpisodeId
    },
    streamIsPlaying() {
      return this.$store.state.streamIsPlaying
    },
    isStreamingFromDifferentLibrary() {
      return this.$store.getters['getIsStreamingFromDifferentLibrary']
    },
    episodesMapped() {
      return this.recentEpisodes.map((ep) => {
        return {
          ...ep,
          progress: this.$store.getters['user/getUserMediaProgress'](ep.libraryItemId, ep.id)
        }
      })
    },
    playerQueueItems() {
      return this.$store.state.playerQueueItems || []
    },
    playerQueueEpisodeIdMap() {
      const episodeIds = {}
      this.playerQueueItems.forEach((i) => {
        if (i.episodeId) episodeIds[i.episodeId] = true
      })
      return episodeIds
    },
    dateFormat() {
      return this.$store.getters['getServerSetting']('dateFormat')
    }
  },
  methods: {
    async toggleEpisodeFinished(episode, confirmed = false) {
      if (this.episodesProcessingMap[episode.id]) {
        console.warn('Episode is already processing')
        return
      }

      const isFinished = !!episode.progress?.isFinished
      const itemProgressPercent = episode.progress?.progress || 0
      if (!isFinished && itemProgressPercent > 0 && !confirmed) {
        const payload = {
          message: this.$getString('MessageConfirmMarkItemFinished', [episode.title]),
          callback: (confirmed) => {
            if (confirmed) {
              this.toggleEpisodeFinished(episode, true)
            }
          },
          type: 'yesNo'
        }
        this.$store.commit('globals/setConfirmPrompt', payload)
        return
      }

      const updatePayload = {
        isFinished: !isFinished
      }

      this.$set(this.episodesProcessingMap, episode.id, true)

      this.$axios
        .$patch(`/api/me/progress/${episode.libraryItemId}/${episode.id}`, updatePayload)
        .catch((error) => {
          console.error('Failed to update progress', error)
          this.$toast.error(updatePayload.isFinished ? this.$strings.ToastItemMarkedAsFinishedFailed : this.$strings.ToastItemMarkedAsNotFinishedFailed)
        })
        .finally(() => {
          this.$set(this.episodesProcessingMap, episode.id, false)
        })
    },
    clickAddToPlaylist(episode) {
      // Makeshift libraryItem
      const libraryItem = {
        id: episode.libraryItemId,
        media: episode.podcast
      }
      this.$store.commit('globals/setSelectedPlaylistItems', [{ libraryItem: libraryItem, episode }])
      this.$store.commit('globals/setShowPlaylistsModal', true)
    },
    async clickEpisode(episode) {
      if (this.openingItem) return
      this.openingItem = true
      const fullLibraryItem = await this.$axios.$get(`/api/items/${episode.libraryItemId}`).catch((error) => {
        var errMsg = error.response ? error.response.data || '' : ''
        this.$toast.error(errMsg || 'Failed to get library item')
        return null
      })
      this.openingItem = false
      if (!fullLibraryItem) return

      this.$store.commit('setSelectedLibraryItem', fullLibraryItem)
      this.$store.commit('globals/setSelectedEpisode', episode)
      this.$store.commit('globals/setShowViewPodcastEpisodeModal', true)
    },
    getButtonText(episode) {
      if (this.episodeIdStreaming === episode.id) return this.streamIsPlaying ? 'Streaming' : 'Play'
      if (!episode.progress) return this.$elapsedPretty(episode.duration)
      if (episode.progress.isFinished) return 'Finished'

      const duration = episode.progress.duration || episode.duration
      const remaining = Math.floor(duration - episode.progress.currentTime)
      return `${this.$elapsedPretty(remaining)} left`
    },
    playClick(episodeToPlay) {
      if (episodeToPlay.id === this.episodeIdStreaming && this.streamIsPlaying) {
        return this.$eventBus.$emit('pause-item')
      }

      // Queue up more recent items
      const queueItems = []
      const episodeIndex = this.episodesMapped.findIndex((e) => e.id === episodeToPlay.id)
      const indexFromBack = this.episodesMapped.length - episodeIndex - 1
      for (let i = this.episodesMapped.length - 1 - indexFromBack; i >= 0; i--) {
        const episode = this.episodesMapped[i]
        if (!episode.progress || !episode.isFinished) {
          queueItems.push({
            libraryItemId: episode.libraryItemId,
            libraryId: episode.libraryId,
            episodeId: episode.id,
            title: episode.title,
            subtitle: episode.podcast.metadata.title,
            caption: episode.publishedAt ? this.$getString('LabelPublishedDate', [this.$formatDate(episode.publishedAt, this.dateFormat)]) : this.$strings.LabelUnknownPublishDate,
            duration: episode.duration || null,
            coverPath: episode.podcast.coverPath || null
          })
        }
      }

      this.$eventBus.$emit('play-item', {
        libraryItemId: episodeToPlay.libraryItemId,
        episodeId: episodeToPlay.id,
        queueItems
      })
    },
    async loadRecentEpisodes(page = 0) {
      this.processing = true
      const episodePayload = await this.$axios.$get(`/api/libraries/${this.libraryId}/recent-episodes?limit=50&page=${page}`).catch((error) => {
        console.error('Failed to get recent episodes', error)
        this.$toast.error(this.$strings.ToastFailedToLoadData)
        return null
      })
      this.processing = false
      this.recentEpisodes = episodePayload.episodes || []
      this.totalEpisodes = episodePayload.total
      this.currentPage = page
    },
    queueBtnClick(episode) {
      if (this.playerQueueEpisodeIdMap[episode.id]) {
        // Remove from queue
        this.$store.commit('removeItemFromQueue', { libraryItemId: episode.libraryItemId, episodeId: episode.id })
      } else {
        // Add to queue
        const queueItem = {
          libraryItemId: episode.libraryItemId,
          libraryId: episode.libraryId,
          episodeId: episode.id,
          title: episode.title,
          subtitle: episode.podcast.metadata.title,
          caption: episode.publishedAt ? this.$getString('LabelPublishedDate', [this.$formatDate(episode.publishedAt, this.dateFormat)]) : this.$strings.LabelUnknownPublishDate,
          duration: episode.duration || null,
          coverPath: episode.podcast.coverPath || null
        }
        this.$store.commit('addItemToQueue', queueItem)
      }
    }
  },
  mounted() {
    this.loadRecentEpisodes()
  }
}
</script>
