const firebaseConfig = {
  apiKey: "AIzaSyDmsZDqHc14x1aNpzbHhdUDbTrVZbNSF-c",
  authDomain: "resqcoord1.firebaseapp.com",
  projectId: "resqcoord1",
  storageBucket: "resqcoord1.firebasestorage.app",
  messagingSenderId: "130816494996",
  appId: "1:130816494996:web:31f5d84e79615ab0be1381",
  measurementId: "G-V1F4XS3WK9"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

const firebaseAuth = firebase.auth();
const firebaseDb = firebase.firestore();
firebaseDb.settings({ ignoreUndefinedProperties: true });
