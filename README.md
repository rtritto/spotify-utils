# Setup
## Install
`git clone https://github.com/rtritto/spotify-utils.git`

`cd spotify-utils`

`yarn`

## Create Spotify's Developer App
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
File `.env`:
```
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
SPOTIFY_PLAYLIST_ID
SPOTIFY_USER_ID
```

# TODO
Functions that need Access Token:
- createPlaylist
- addItemsToPlaylist
Guide:
- [Implementing the Authorization Code Flow](https://www.newline.co/courses/build-a-spotify-connected-app/implementing-the-authorization-code-flow)
