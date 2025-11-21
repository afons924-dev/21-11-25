import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyBEx65udqc4UsRRXcQ7YwJdE0UFmloBvfc",
  authDomain: "desire-loja-final.firebaseapp.com",
  projectId: "desire-loja-final",
  storageBucket: "desire-loja-final.firebasestorage.app",
  messagingSenderId: "1076992474501",
  appId: "1:1076992474501:web:c46cf52dcd408748abd8ec",
  measurementId: "G-2NSFKWXG77"
};

const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);
export const functions = getFunctions(firebaseApp, "europe-west3");
