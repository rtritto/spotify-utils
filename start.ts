import { spawn } from 'node:child_process'

import {
  getPlaylist,
  createPlaylist,
  addItemsToPlaylist,
  getUrisFromFiles
} from './src/index.ts'

// const playlist = await getPlaylist()
// console.log('getPlaylist: OK');

// const { id } = await createPlaylist({ name: 'Phonk 2' })
// console.log('createPlaylist: OK');

// await addItemsToPlaylist({ playlist_id: id, playlistFilepath: 'playlist-<NAME>-20240330T002732.json' })
// console.log('addItemsToPlaylist: OK');

const uris = getUrisFromFiles('playlist-All-20240330T121626.json')
console.log('uris: ', uris);
const proc = spawn('clip')
proc.stdin.write(JSON.stringify(uris))
proc.stdin.end()

// await addItemsToPlaylist({ playlist_id: '', uris })
// console.log('addItemsToPlaylist: OK');
// await addItemsToPlaylist({ playlist_id: '', uris: ['spotify:track:5MNfAmHvsqOliIxtwiFzsz'] })
// console.log('addItemsToPlaylist: OK');