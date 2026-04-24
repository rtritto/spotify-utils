import fs from 'node:fs'
import path from 'node:path'
// import { SpotifyApi } from '@spotify/web-api-ts-sdk'
import type { Playlist, Track, TrackItem } from '@spotify/web-api-ts-sdk'

import { createFile, createFolder, FILE_OPTIONS, getCurrentDateString, getInputPath, getOutputPath } from './folderUtils'

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_PLAYLIST_ID,
  // SPOTIFY_USER_ID
  BEARER_TOKEN,
  BEARER_TOKEN_FILEPATH = '.token.json'
} = process.env

// let api: SpotifyApi
/** @link https://developer.spotify.com/documentation/web-api/concepts/access-token */
let access_token: string

/**
 * expires_in: The time period (in seconds) for which the access token is valid.
 *   Access tokens are valid for a maximum of one hour.
 *   The response also returns a timestamp of when the token expires,
 *   which you can use to calculate when to refresh the token.
 * @returns boolean
 */
const _isTokenValid = (): boolean => {
  const { mtimeMs } = fs.statSync(BEARER_TOKEN_FILEPATH)
  const diffMs = Date.now() - mtimeMs
  const { expires_in } = JSON.parse(fs.readFileSync(BEARER_TOKEN_FILEPATH, FILE_OPTIONS))
  return diffMs <= (expires_in * 1000)
}

const _set = async () => {
  if (access_token) {
    return
  }
  if (BEARER_TOKEN) {
    access_token = BEARER_TOKEN
  } else if (createFile(BEARER_TOKEN_FILEPATH) || !_isTokenValid()) {
    /** @link https://developer.spotify.com/documentation/web-api/tutorials/getting-started */
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: SPOTIFY_CLIENT_ID!,
        client_secret: SPOTIFY_CLIENT_SECRET!
      })
    }).then(res => res.json()) as {
      access_token: string
      token_type: string
      expires_in: number
    }
    ({ access_token } = tokenResponse)
    if (access_token) {
      fs.writeFileSync(BEARER_TOKEN_FILEPATH, JSON.stringify(tokenResponse), FILE_OPTIONS)
    } else {
      throw new Error('Failed to get access token')
    }
  } else {
    ({ access_token } = JSON.parse(fs.readFileSync(BEARER_TOKEN_FILEPATH, FILE_OPTIONS)))
  }
  // OR
  // if (api) {
  //   return
  // }
  // api = SpotifyApi.withClientCredentials(
  //   SPOTIFY_CLIENT_ID!,
  //   SPOTIFY_CLIENT_SECRET!
  // )
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
  await _set()
  const playlist = await fetch(`https://api.spotify.com/v1/playlists/${playlist_id}`, {
    headers: {
      Authorization: `Bearer ${access_token}`
    }
  }).then(async (response) => {
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Failed to fetch playlist: ${response.statusText} - ${text}`)
    }
    return response.json()
  })
  // OR
  // const playlist = await api.playlists.getPlaylist(playlist_id)
  if (save) {
    // Backup the playlist
    const currentDateComplete = getCurrentDateString(/* true */)
    const YYYYMMDD_FolderPath = getOutputPath(currentDateComplete.slice(0, 8))
    createFolder(YYYYMMDD_FolderPath)
    // const playlistFilename = `playlist-${playlist_id}-${ts}.json`
    const playlistFilename = `${currentDateComplete}-${playlist.name}.json`
    const filepath = path.join(YYYYMMDD_FolderPath, playlistFilename)
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
  // user_id = SPOTIFY_USER_ID!
}: CreatePlaylistParams): Promise<Playlist<TrackItem>> => {
  const playlist = await fetch('https://api.spotify.com/v1/me/playlists', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`
    },
    body: JSON.stringify({
      name,
      public: true
      // description
    })
  }).then((response) => response.json())
  // OR
  // const playlist = await api.playlists.createPlaylist(user_id!, {
  //   name,
  //   public: true
  //   // collaborative
  //   // description
  // })
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
 * @link https://developer.spotify.com/documentation/web-api/reference/add-items-to-playlist
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
  await fetch(`https://api.spotify.com/v1/playlists/${playlist_id}/items`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`
    },
    body: JSON.stringify({
      uris: Uris
      // position: 0
    })
  })
  // OR
  // await api.playlists.addItemsToPlaylist(playlist_id!, Uris)
}

type ArtistItem = {
  id: string
  name: string
}

type GetFollowingResponse = {
  artists: {
    href: string
    items: ArtistItem[]
    limit: number
    next: string | null
    offset: number
    previous: string | null
    total: number
  }
}

/**
 * @link https://developer.spotify.com/documentation/web-api/reference/get-followed
 */
export const getFollowing = async ({ save = true }: { save?: boolean } = {}) => {
  await _set()
  let allFollowing = []
  const firstFollowing = await fetch('https://api.spotify.com/v1/me/following?type=artist&limit=50', {
    headers: {
      Authorization: `Bearer ${access_token}`
    }
  }).then((response) => response.json() as Promise<GetFollowingResponse>)
  allFollowing.push(...firstFollowing.artists.items)

  let next = firstFollowing.artists.next
  while (next) {
    const currentFollowing = await fetch(next, {
      headers: {
        Authorization: `Bearer ${access_token}`
      }
    }).then((response) => response.json() as Promise<GetFollowingResponse>)
    allFollowing.push(...currentFollowing.artists.items)
    next = currentFollowing.artists.next
  }
  if (save) {
    // Backup the following list
    const currentDateComplete = getCurrentDateString(/* true */)
    const YYYYMMDD_FolderPath = getOutputPath(currentDateComplete.slice(0, 8))
    createFolder(YYYYMMDD_FolderPath)
    const playlistFilename = `${currentDateComplete}-Following.json`
    const filepath = path.join(YYYYMMDD_FolderPath, playlistFilename)
    fs.writeFileSync(filepath, JSON.stringify(allFollowing))
  }
  return allFollowing
}

export const getUrisFromFiles = (playlistFilepath: string) => {
  const Playlist = _getPlaylistFromFile(playlistFilepath)
  return _getUrisFromPlaylist(Playlist!)
}
