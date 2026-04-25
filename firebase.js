import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDDgYLDwuwjDzjPnHv9CbpmaRfzExFO5rE",
  authDomain: "bilancio-nico.firebaseapp.com",
  projectId: "bilancio-nico",
  storageBucket: "bilancio-nico.firebasestorage.app",
  messagingSenderId: "828281781529",
  appId: "1:828281781529:web:4f91d7c1d0885445a55988"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };
