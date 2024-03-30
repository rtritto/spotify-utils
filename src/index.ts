import fs from 'node:fs'
import { SpotifyApi } from '@spotify/web-api-ts-sdk'
import type { Playlist, Track, TrackItem } from '@spotify/web-api-ts-sdk'

import { getInputPath, getOutputPath } from '@/fileUtils'

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_PLAYLIST_ID,
  SPOTIFY_USER_ID
} = process.env

let api: SpotifyApi

const _setApi = () => {
  api = SpotifyApi.withClientCredentials(
    SPOTIFY_CLIENT_ID!,
    SPOTIFY_CLIENT_SECRET!
  )
}

type GetPlaylistParams = {
  save?: boolean
  playlist_id?: string
}

/**
 * @link https://developer.spotify.com/documentation/web-api/reference/get-playlist
 */
export const getPlaylist = async ({
  save = true,
  playlist_id = SPOTIFY_PLAYLIST_ID!
}: GetPlaylistParams = {}): Promise<Playlist<Track>> => {
  _setApi()
  const playlist = await api.playlists.getPlaylist(playlist_id)
  if (save === true) {
    // Backup the playlist
    const ts = new Date()   // timestamp
      .toISOString()
      .slice(0, -5)   // remove millis
      .split(/:|-/)   // remove : and -
      .join('')
    // const playlistFilename = `playlist-${playlist_id}-${ts}.json`
    const playlistFilename = `playlist-${playlist.name}-${ts}.json`
    const filepath = getOutputPath(playlistFilename)
    fs.writeFileSync(filepath, JSON.stringify(playlist))
  }
  return playlist
}

type CreatePlaylistParams = {
  name: string
  user_id?: string
}

/**
 * @link https://developer.spotify.com/documentation/web-api/reference/create-playlist
 */
export const createPlaylist = async ({
  name,
  user_id = SPOTIFY_USER_ID!
}: CreatePlaylistParams): Promise<Playlist<TrackItem>> => {
  const playlist = await api.playlists.createPlaylist(user_id!, {
    name,
    public: true
    // collaborative
    // description
  })
  return playlist
}

const _getPlaylistFromFile = (playlistFilepath: string): Playlist<Track> => {
  const filepath = getInputPath(playlistFilepath)
  const playlistRaw = fs.readFileSync(filepath, { encoding: 'utf8' })
  return JSON.parse(playlistRaw) as Playlist<Track>
}

const _getUrisFromPlaylist = (playlist: Playlist<Track>) => {
  return playlist.tracks.items.map((item) => item.track.uri)
}

type AddItemsToPlaylistParams = {
  playlist_id?: string
  uris?: string[]
  playlistFilepath?: string
  playlist?: Playlist<Track>
}

/**
 * @link https://developer.spotify.com/documentation/web-api/reference/add-tracks-to-playlist
 */
export const addItemsToPlaylist = async ({
  uris,
  playlistFilepath,
  playlist,
  playlist_id = SPOTIFY_PLAYLIST_ID!
}: AddItemsToPlaylistParams): Promise<void> => {
  let Uris
  if (uris) {
    Uris = uris
  } else {
    const Playlist = playlistFilepath ? _getPlaylistFromFile(playlistFilepath) : playlist
    Uris = _getUrisFromPlaylist(Playlist!)
  }
  await api.playlists.addItemsToPlaylist(playlist_id!, Uris)
}

export const getUrisFromFiles = (playlistFilepath: string) => {
  const Playlist = _getPlaylistFromFile(playlistFilepath)
  return _getUrisFromPlaylist(Playlist!)
}