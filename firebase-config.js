// Fill your Firebase project config here. Get it from Firebase Console > Project settings > General > Your apps.
// Example:
// window.FIREBASE_CONFIG = {
//   apiKey: "...",
//   authDomain: "...",
//   databaseURL: "...",
//   projectId: "...",
//   storageBucket: "...",
//   messagingSenderId: "...",
//   appId: "..."
// };

window.FIREBASE_CONFIG = window.FIREBASE_CONFIG || null;

if (!window.FIREBASE_CONFIG) {
  console.warn('[Ultimate Ping Pong] Firebase config missing. Google sign-in and Online PvP will be disabled until configured.');
}
