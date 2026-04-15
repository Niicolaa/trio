/**
 * Firebase Configuration for Trio Multiplayer Game
 *
 * HOW TO SET UP FIREBASE (free, takes ~5 minutes):
 * ─────────────────────────────────────────────────
 * 1. Go to https://console.firebase.google.com
 * 2. Click "Add project" → give it a name (e.g. "trio-game")
 * 3. Disable Google Analytics (optional) → Create project
 * 4. In the left sidebar: Build → Realtime Database → Create database
 *    - Choose a location near you
 *    - Start in TEST MODE (for development)
 * 5. In the left sidebar: Project settings (gear icon) → General tab
 *    - Scroll down to "Your apps" → click </> (Web)
 *    - Register app → copy the firebaseConfig object
 * 6. Paste the values below, replacing each "YOUR_..." placeholder
 * 7. In Realtime Database → Rules → paste these rules and Publish:
 *
 *    {
 *      "rules": {
 *        "rooms": {
 *          "$roomId": {
 *            ".read": true,
 *            ".write": true
 *          }
 *        }
 *      }
 *    }
 *
 * 8. In Authentication → Settings → Authorized domains → add your
 *    GitHub Pages domain (e.g. username.github.io)
 */

const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

export default FIREBASE_CONFIG;
