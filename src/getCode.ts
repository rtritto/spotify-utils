import { exec } from 'node:child_process'
import http from 'node:http'

const { SPOTIFY_CLIENT_ID: CLIENT_ID } = process.env

const REDIRECT_URI = 'http://127.0.0.1:8888/callback'
const loginUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_URI}`

const getCode = async (): Promise<string> => {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      // Build a URL object to easily extract route and parameters
      const reqUrl = new URL(req.url!, `http://${req.headers.host}`)

      // Check that the browser is calling the correct route
      if (reqUrl.pathname === '/callback') {
        const code = reqUrl.searchParams.get('code')

        if (code) {
          // Send an HTML response to the browser
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end('<div style="font-family: sans-serif; text-align: center; margin-top: 50px;">'
            + '<h1 style="color: #1DB954;">Login successful!</h1>'
            + '<p>You can close this window and return to the terminal.</p>'
            + '</div>'
          )

          // console.log('Authorization code captured automatically:', code)

          // Close the server after handling the callback
          server.close()
          setTimeout(() => process.exit(0), 1000)
          resolve(code)
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end('<h1>Error</h1><p>No authorization code received.</p>')
          setTimeout(() => process.exit(1), 1000)
          reject(new Error('No authorization code received'))
        }
      } else {
        // Ignore requests
        res.writeHead(404)
        res.end()
      }
    })

    // Start the local server on port 8888
    server.listen(8888, '127.0.0.1', () => {
      console.log('Server listening.\nOpening browser for login with URL:', loginUrl)

      // Cross-platform command to open the default browser
      const start = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open'
      exec(`${start} "${loginUrl}"`)
    })
  })
}

export default getCode
