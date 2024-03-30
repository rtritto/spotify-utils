import {
  getPlaylist,
  createPlaylist,
  addItemsToPlaylist,
  getUrisFromFiles
} from './src/index.ts'

const playlist = await getPlaylist()
console.log('getPlaylist: OK');
const { id } = await createPlaylist({ name: 'Phonk 2' })
console.log('createPlaylist: OK');
await addItemsToPlaylist({ playlist_id: id, playlistFilepath: 'playlist-<PLAYLIST_ID>-20240330T002732.json' })
console.log('addItemsToPlaylist: OK');
const uris = getUrisFromFiles('playlist-<PLAYLIST_ID>-20240330T002732.json')
console.log('uris: ', uris);
await addItemsToPlaylist({ playlist_id: '', uris })
console.log('addItemsToPlaylist: OK');
await addItemsToPlaylist({ playlist_id: '', uris: ['spotify:track:5MNfAmHvsqOliIxtwiFzsz'] })
console.log('addItemsToPlaylist: OK');