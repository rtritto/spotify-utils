# spotify-utils
- Download Liked Tracks, Playlists, Albums, Artists from https://www.tunemymusic.com/backup
- Move Liked Tracks, Playlists, Albums, Artists, Podcasts from https://trikatuka.aknakn.eu

## Create Spotify's Developer App
> Same guide on [Getting started with Web API](https://developer.spotify.com/documentation/web-api/tutorials/getting-started)

- Go to https://developer.spotify.com/dashboard
- Create a new App as follow:

  | Field  | Value |
  | ------------- | ------------- |
  | App name | My App |
  | App description | My awesome app |
  | Redirect URI | http://localhost:3000 |

- Tick
  - "Web API"
  - "I understand and agree with Spotify's Developer Terms of Service and Design Guidelines"
- Save

## Set credentials
- Open Spotify's Developer App
- Go to _Settings_
- Copy _Cliend ID_ and _Client Secret_ values and set environment variables in `.env` file:

  | Environment variable  | Value |
  | ------------- | ------------- |
  | SPOTIFY_CLIENT_ID | Client ID |
  | SPOTIFY_CLIENT_SECRET | Client Secret |

# Backup
## Create Backup of a Playlist
- Update `start.ts` file:
```ts
import { getPlaylist } from './src/index.ts'

// Use default process.env.SPOTIFY_PLAYLIST_ID value as Playlist ID
await getPlaylist()
// OR use a specific Playlist ID
await getPlaylist({ playlist_id: <PLAYLIST_ID> })
// playlist-<PLAYLIST_NAME>-20240000T000000.json is saved
```

- Run `yarn start`

## Restore Backup of a Playlist
- Choose 1 to create a Playlist:
  - [Create a Playlist with Wep API](https://developer.spotify.com/documentation/web-api/reference/create-playlist)
    - complete "REQUEST BODY"
      ```json
      {
        "name": <PLAYLIST_NAME>,
        "public": true
      }
      ```
    - click `Try it` button
  - Create a Playlist using _Spotify Web_
  - Create a Playlist using _Spotify Windows program_
- Choose 1 to get _Playlist ID_:
  - In _Web Api_ (after clicked `Try it` button)
    - from `id` field in "RESPONSE SAMPLE"
  - In _Spotify Web_
    - click on a playlist
    - copy the _Playlist ID_ from browser _url_
  - In _Spotify Windows program_
    - right button on playlist
    - "Share"
    - "Copy link to playlist"
    - Get from value
- Get _Uris_
  - Update `start.ts` file:
    ```ts
    import { getUrisFromFiles } from './src/index.ts'

    await getUrisFromFiles(<JSON_FILENAME_IN_INPUT_FOLDER>)
    ```
  - Run `yarn start`
- Go to [Add Items to Playlist](https://developer.spotify.com/documentation/web-api/reference/add-tracks-to-playlist)
  - set `playlist_id` as _Playlist ID_
  - set _Uris_ in "REQUEST BODY"
    ```json
    {
      "uris": [
        <URI_0>,
        ...
      ]
    }
    ```
  - click `Try it` button

# Environment variables
File `.env`

| Name | Default
| - | -
`SPOTIFY_CLIENT_ID`
`SPOTIFY_CLIENT_SECRET`
`SPOTIFY_PLAYLIST_ID`
`SPOTIFY_USER_ID`
`INPUT_FOLDER` | `./input`
`OUTPUT_FOLDER` | `./output`
`BEARER_TOKEN`
`BEARER_TOKEN_FILEPATH` | `.bearer_token`

# BREAKING CHANGES
- July 2026 → New blocks
- [February 2026 Migration Guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
## Workarounds
### Get Bearer Token from Spotify Developer website
1. F12 → Network OR Ctrl+Shift+E
2. Open Spotify Web `https://developer.spotify.com`
3. Find `https://accounts.spotify.com/api/token`
4. Copy `access_token` value from Response
5. Use the access token as `BEARER_TOKEN` environment variable

### Get Playlist from the Developer Website using get-playlist API
1. If Firefox Desktop, go to `about:config` and set `devtools.netmonitor.responseBodyLimit` = 0
2. F12 → Network OR Ctrl+Shift+E
3. Open Spotify Web `https://developer.spotify.com/documentation/web-api/reference/get-playlist`
4. Click `Try it` button
5. Find `https://api.spotify.com/v1/playlists/<PLAYLIST_ID>`
6. Left click → Copy Value → Copy Response

> !Draft
### Get Code/Bearer Token from Developer Website
1. Go to `https://developer.spotify.com/dashboard/<SPOTIFY_CLIENT_ID>`
2. To "Redirect URIs" add `http://127.0.0.1:8888/callback` (see https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)

# TODO
- Implement get liked songs with the API [Get User's Saved Tracks](https://developer.spotify.com/documentation/web-api/reference/get-users-saved-tracks)
Guide:
- [Implementing the Authorization Code Flow](https://www.newline.co/courses/build-a-spotify-connected-app/implementing-the-authorization-code-flow)
