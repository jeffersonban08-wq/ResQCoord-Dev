const Auth = (() => {
  let currentId = null;
  let initializing;

  async function loadProfile(firebaseUser, expectedRole) {
    const snapshot = await firebaseDb.collection('users').doc(firebaseUser.uid).get();
    if (!snapshot.exists) {
      const request = await firebaseDb.collection('adminRequests').doc(firebaseUser.uid).get();
      await firebaseAuth.signOut();
      currentId = null;
      if (request.exists && request.data().status === 'pending') {
        throw new Error('Your administrator registration is pending approval by the project owner.');
      }
      throw new Error('This account has no ResQCoord profile. Ask the project administrator to provision it.');
    }
    const profile = { ...snapshot.data(), id: snapshot.id };
    if (!['admin', 'user'].includes(profile.role)) {
      await firebaseAuth.signOut();
      currentId = null;
      throw new Error('This account has an invalid ResQCoord role.');
    }
    if (expectedRole && profile.role !== expectedRole) {
      await firebaseAuth.signOut();
      currentId = null;
      throw new Error('This account is not registered as a ' + (expectedRole === 'admin' ? 'administrator' : 'responder') + '.');
    }
    currentId = firebaseUser.uid;
    await DB.initialize(profile);
    return profile;
  }

  async function initialize() {
    if (initializing) return initializing;
    initializing = new Promise((resolve, reject) => {
      let unsubscribe;
      unsubscribe = firebaseAuth.onAuthStateChanged(async firebaseUser => {
        unsubscribe();
        try {
          if (firebaseUser) await loadProfile(firebaseUser);
          else {
            currentId = null;
            await DB.initializeGuest();
          }
          resolve(current());
        } catch (error) {
          reject(error);
        }
      }, reject);
    }).finally(() => { initializing = null; });
    return initializing;
  }

  async function register(role, fields) {
    if (role !== 'user') throw new Error('Admin accounts are created by the project owner, not through public registration.');
    if (!fields.name || !fields.email || !fields.password || fields.password.length < 6 || !fields.teamId) {
      throw new Error('Fill in all fields and choose a team. Password needs at least 6 characters.');
    }
    const credential = await firebaseAuth.createUserWithEmailAndPassword(fields.email, fields.password);
    const user = credential.user;
    const profile = {
      id: user.uid,
      role: 'user',
      name: fields.name,
      org: '',
      email: fields.email,
      teamId: fields.teamId,
      responderId: 'FR-' + user.uid.slice(0, 6).toUpperCase(),
      status: 'Standby',
      sharing: true,
      locMode: 'gps',
      nextCheckin: new Date(Date.now() + 15 * 60000).toISOString(),
      createdAt: new Date().toISOString()
    };
    try {
      await DB.ensureSignupTeam(fields.teamId);
      await DB.createUser(profile);
      return profile;
    } catch (error) {
      await user.delete();
      if (error.code === 'permission-denied') {
        throw new Error('Firebase denied the signup. Publish the current firestore.rules file in Firebase Console, then try again.');
      }
      throw error;
    }
  }

  async function requestAdmin(fields) {
    if (!fields.name || !fields.org || !fields.email || !fields.password || fields.password.length < 6) {
      throw new Error('Fill in all fields. Password needs at least 6 characters.');
    }
    const credential = await firebaseAuth.createUserWithEmailAndPassword(fields.email, fields.password);
    const user = credential.user;
    try {
      await firebaseDb.collection('adminRequests').doc(user.uid).set({
        id: user.uid,
        name: fields.name,
        org: fields.org,
        email: user.email,
        status: 'pending',
        createdAt: new Date().toISOString()
      });
      await firebaseAuth.signOut();
    } catch (error) {
      await user.delete();
      throw error;
    }
  }

  async function login(role, email, password) {
    let credential;
    try {
      credential = await firebaseAuth.signInWithEmailAndPassword(email, password);
      const profile = await loadProfile(credential.user, role);
      return profile;
    } catch (error) {
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        throw new Error('Wrong email or password.');
      }
      throw error;
    }
  }

  const current = () => currentId ? DB.get('users', currentId) : null;

  function guard(role) {
    const user = current();
    if (!user || user.role !== role) {
      location.href = role === 'admin' ? 'admin-login.html' : 'user-login.html';
      return null;
    }
    return user;
  }

  async function logout() {
    await firebaseAuth.signOut();
    currentId = null;
    location.href = 'index.html';
  }

  async function sendPasswordReset(email) {
    if (!email) throw new Error('This account does not have an email address.');
    await firebaseAuth.sendPasswordResetEmail(email);
  }

  return { initialize, register, requestAdmin, login, current, guard, logout, sendPasswordReset };
})();
