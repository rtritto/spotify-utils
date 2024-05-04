import { spawn } from 'node:child_process'

import {
  getPlaylist,
  createPlaylist,
  addItemsToPlaylist,
  getUrisFromFiles
} from './src/index.ts'

//#region getPlaylist
const playlist = await getPlaylist({
  playlist_id:
    'XXXXXXXXXXXXXXXXXXXXXX'  // All
})
console.log('getPlaylist: OK')
//#endregion

//#region createPlaylist
// const { id } = await createPlaylist({ name: 'Phonk 2' })
// console.log('createPlaylist: OK');
//#endregion

//#region addItemsToPlaylist
// await addItemsToPlaylist({ playlist_id: id, playlistFilepath: 'playlist-<NAME>-20240330T002732.json' })
// console.log('addItemsToPlaylist: OK');
//#endregion

//#region getUrisFromFiles
// const uris = getUrisFromFiles('playlist-All-20240330T121626.json')
// console.log('uris: ', uris);
// Copy to Windows Clipboard
// const proc = spawn('clip')
// proc.stdin.write(JSON.stringify(uris))
// proc.stdin.end()
//#endregion

//#region addItemsToPlaylist
// await addItemsToPlaylist({ playlist_id: '', uris })
// console.log('addItemsToPlaylist: OK');
// await addItemsToPlaylist({ playlist_id: '', uris: ['spotify:track:5MNfAmHvsqOliIxtwiFzsz'] })
// console.log('addItemsToPlaylist: OK');
//#endregion