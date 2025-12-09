// constants/firebase.ts
import 'firebase/compat/firestore';
import { initializeApp } from 'firebase/app';
import firebaseJson from '../../firebase.json';
const { emulators } = firebaseJson;

import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getDatabase, connectDatabaseEmulator } from 'firebase/database';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const firebaseApp = initializeApp(firebaseConfig);
export const firestore = getFirestore(firebaseApp);
export const database = getDatabase(firebaseApp);
export const functions = getFunctions(firebaseApp, import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION);
export const storage = getStorage(firebaseApp);
export const auth = getAuth(firebaseApp);

(window as any).auth = auth;

import { GoogleAuthProvider } from 'firebase/auth';

export const googleProvider = new GoogleAuthProvider();

export const VITE_VOCA_ENV = import.meta.env.VITE_VOCA_ENV || 'localdev';
if (VITE_VOCA_ENV === 'localdev') {
  let hostname = window.location.hostname;
  if (window.location.hostname === 'localhost') {
    hostname = '127.0.0.1';
  }

  connectFirestoreEmulator(firestore, hostname, emulators.firestore.port);
  connectDatabaseEmulator(database, hostname, emulators.database.port);
  connectFunctionsEmulator(functions, hostname, emulators.functions.port);
  connectStorageEmulator(storage, hostname, emulators.storage.port);
  connectAuthEmulator(auth, `http://${hostname}:${emulators.auth.port}`);
}
