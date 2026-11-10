const DB = (() => {
  const TABLES = ['users', 'teams', 'missions', 'incidents', 'messages', 'resources', 'sos'];
  const uid = p => p + '-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  const ago = m => new Date(Date.now() - m * 60000).toISOString();
  const state = {
    users: [], teams: [], missions: [], incidents: [], messages: [], resources: [], sos: []
  };
  const listeners = new Set();
  let unsubscribers = [];
  let profile = null;
  let ready = false;

  function seed() {
    return {
      users: [],
      teams: [
        { id:'T-ALPHA', name:'Team Alpha', members:12, status:'On site', lat:16.4031, lng:120.5987, note:'North spur' },
        { id:'T-BRAVO', name:'Team Bravo', members:9, status:'En route', lat:16.3985, lng:120.6045, note:'Sector B', target:[16.4092, 120.6003] },
        { id:'T-CHARLIE', name:'Team Charlie', members:8, status:'SOS', lat:16.4092, lng:120.6003, note:'Sector C' },
        { id:'T-DELTA', name:'Team Delta', members:4, status:'Standby', lat:16.3960, lng:120.5900, note:'East ridge' }
      ],
      missions: [{
        id:'MSN-2026-014', name:'Mt. Lantin Rescue', type:'Mountain SAR', priority:'High', status:'In progress', geofenceRadius:500,
        teamId:'T-ALPHA', sector:'N-2', lat:16.4075, lng:120.5995, lead:'Lt. Mara Santos',
        brief:'2 lost hikers (1 male, 1 female). Last seen North spur trailhead 09:40. Light rain, visibility 300 m. Rockfall in Sector C, wet slopes.',
        createdAt:ago(192),
        timeline:[{t:'11:20',e:'Mission dispatched'},{t:'12:05',e:'Team Alpha on site'},{t:'13:40',e:'Drone scan started in sector N-2'}]
      }],
      incidents: [
        { id:'INC-0001', type:'Hazard', severity:'High', desc:'Rockfall near Sector C', reporterName:'Cpl. Dela Cruz', teamId:'T-ALPHA', status:'Escalated', lat:16.4092, lng:120.6003, createdAt:ago(90) },
        { id:'INC-0002', type:'Equipment', severity:'Low', desc:'Radio battery low', reporterName:'Team Charlie', teamId:'T-CHARLIE', status:'Resolved', lat:16.4075, lng:120.5950, createdAt:ago(60) }
      ],
      messages: [
        { id:'MSG-1', teamId:'T-ALPHA', senderId:'cmd', senderName:'Command Center', role:'admin', text:'Drone scan found 2 heat signatures in grid N-2.', createdAt:ago(11) },
        { id:'MSG-2', teamId:'T-ALPHA', senderId:'cmd', senderName:'Command Center', role:'admin', text:'Team Alpha, advance to ridge marker. Report on arrival.', createdAt:ago(4) },
        { id:'MSG-3', teamId:'ALL', senderId:'cmd', senderName:'Command Center', role:'admin', text:'Keep radio checks every 15 min.', createdAt:ago(2) }
      ],
      resources: [
        { id:'RES-1', name:'Rescue truck 1', type:'Vehicle', qty:1, status:'Deployed', teamId:'T-ALPHA', createdAt:ago(500) },
        { id:'RES-2', name:'Stretcher', type:'Medical', qty:6, status:'Available', teamId:'', createdAt:ago(500) },
        { id:'RES-3', name:'Rope 60 m', type:'Equipment', qty:10, status:'Available', teamId:'', createdAt:ago(500) },
        { id:'RES-4', name:'Drone', type:'Equipment', qty:2, status:'Deployed', teamId:'T-DELTA', createdAt:ago(500) }
      ],
      sos: [{ id:'SOS-1', teamId:'T-CHARLIE', senderName:'Team Charlie', note:'Sector C rockfall', lat:16.4092, lng:120.6003, status:'Active', createdAt:ago(22) }]
    };
  }

  function reportError(error) {
    console.error('Firebase operation failed:', error);
    dispatchEvent(new CustomEvent('resqcoord:error', { detail: error }));
  }

  function notify() {
    listeners.forEach(callback => callback());
  }

  function setRows(table, rows, shouldNotify = true) {
    state[table] = rows.map(row => ({ ...row }));
    if (shouldNotify) notify();
  }

  function docRows(snapshot) {
    return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
  }

  function queriesFor(table, user) {
    const collection = firebaseDb.collection(table);
    if (user.role === 'admin') return [collection];
    if (table === 'users') return [collection.doc(user.id)];
    if (table === 'teams') return user.teamId ? [collection.doc(user.teamId)] : [];
    if (table === 'resources') return [collection];
    if (!user.teamId) return [];
    if (table === 'messages') return [
      collection.where('teamId', '==', user.teamId),
      collection.where('teamId', '==', 'ALL')
    ];
    if (['missions', 'incidents', 'sos'].includes(table)) return [collection.where('teamId', '==', user.teamId)];
    return [];
  }

  async function queryRows(query) {
    const snapshot = await query.get();
    return snapshot.docs ? docRows(snapshot) : snapshot.exists ? [{ ...snapshot.data(), id: snapshot.id }] : [];
  }

  async function watchTable(table, user) {
    const queries = queriesFor(table, user);
    const initial = await Promise.all(queries.map(queryRows));
    const merge = rows => {
      const byId = new Map();
      rows.flat().forEach(row => byId.set(row.id, row));
      const merged = [...byId.values()];
      setRows(table, merged);
      if (table === 'users' && user.role === 'user' && merged[0] && merged[0].teamId !== user.teamId) {
        initialize(merged[0]).catch(reportError);
      }
    };
    merge(initial);
    queries.forEach(query => {
      let first = true;
      const unsubscribe = query.onSnapshot(snapshot => {
        if (first) { first = false; return; }
        Promise.all(queries.map(queryRows)).then(merge).catch(reportError);
      }, reportError);
      unsubscribers.push(unsubscribe);
    });
  }

  async function seedCloud() {
    const sample = seed();
    const batch = firebaseDb.batch();
    TABLES.filter(table => table !== 'users').forEach(table => {
      sample[table].forEach(row => batch.set(firebaseDb.collection(table).doc(row.id), row));
    });
    await batch.commit();
  }

  async function migrateLegacyTeams() {
    const replacements = { 'T-R12': 'T-CHARLIE', 'T-AU2': 'T-DELTA' };
    for (const [legacyId, teamId] of Object.entries(replacements)) {
      const legacy = await firebaseDb.collection('teams').doc(legacyId).get();
      if (!legacy.exists) continue;

      for (const table of ['users', 'missions', 'incidents', 'messages', 'resources', 'sos']) {
        const snapshot = await firebaseDb.collection(table).where('teamId', '==', legacyId).get();
        for (let offset = 0; offset < snapshot.docs.length; offset += 450) {
          const batch = firebaseDb.batch();
          snapshot.docs.slice(offset, offset + 450).forEach(doc => batch.update(doc.ref, { teamId }));
          await batch.commit();
        }
      }

      await firebaseDb.collection('teams').doc(legacyId).delete();
    }

    const teams = seed().teams;
    for (const team of teams) {
      const ref = firebaseDb.collection('teams').doc(team.id);
      const existing = await ref.get();
      if (!existing.exists) await ref.set(team);
      else if (existing.data().name !== team.name) await ref.update({ name: team.name });
    }
  }

  async function initializeGuest() {
    clearSubscriptions();
    profile = null;
    TABLES.forEach(table => setRows(table, table === 'teams' ? seed().teams : [], false));
    ready = true;
  }

  async function initialize(user) {
    clearSubscriptions();
    profile = user;
    TABLES.forEach(table => setRows(table, [], false));
    if (user.role === 'admin') {
      const teams = await firebaseDb.collection('teams').limit(1).get();
      if (teams.empty) await seedCloud();
      await migrateLegacyTeams();
    }
    await Promise.all(TABLES.map(table => watchTable(table, user)));
    ready = true;
  }

  async function ensureSignupTeam(teamId) {
    const team = seed().teams.find(row => row.id === teamId);
    if (!team) throw new Error('Choose one of the listed teams.');
    try {
      await firebaseDb.collection('teams').doc(team.id).set(team);
    } catch (error) {
      if (error.code !== 'permission-denied') throw error;
    }
  }

  function clearSubscriptions() {
    unsubscribers.forEach(unsubscribe => unsubscribe());
    unsubscribers = [];
  }

  function persist(table, row, operation) {
    if (!ready || !firebaseAuth.currentUser) {
      reportError(new Error('Sign in before changing Firebase data.'));
      return;
    }
    const ref = firebaseDb.collection(table).doc(row.id);
    let task;
    if (operation === 'delete') task = ref.delete();
    else if (operation === 'update') task = ref.set(row, { merge: true });
    else task = ref.set(row);
    task.catch(async error => {
      reportError(error);
      try {
        const rows = await Promise.all(queriesFor(table, profile).map(queryRows));
        setRows(table, rows.flat());
      } catch (refreshError) {
        reportError(refreshError);
      }
    });
  }

  function all(table) { return state[table] || []; }
  function get(table, id) { return all(table).find(row => row.id === id); }

  return {
    uid,
    all,
    get,
    initializeGuest,
    initialize,
    ensureSignupTeam,
    createUser: async row => {
      row.createdAt = row.createdAt || new Date().toISOString();
      await firebaseDb.collection('users').doc(row.id).set(row);
      state.users = [...state.users.filter(user => user.id !== row.id), row];
      return row;
    },
    insert(table, row) {
      if (!TABLES.includes(table)) throw new Error('Unknown data collection: ' + table);
      row.id = row.id || uid(table.slice(0, 3).toUpperCase());
      row.createdAt = row.createdAt || new Date().toISOString();
      state[table] = [...state[table], row];
      notify();
      persist(table, row, 'insert');
      return row;
    },
    update(table, id, patch) {
      const row = get(table, id);
      if (!row) return undefined;
      Object.assign(row, patch);
      notify();
      persist(table, row, 'update');
      return row;
    },
    remove(table, id) {
      if (!TABLES.includes(table)) throw new Error('Unknown data collection: ' + table);
      state[table] = state[table].filter(row => row.id !== id);
      notify();
      persist(table, { id }, 'delete');
    },
    async reset() {
      if (profile?.role !== 'admin') throw new Error('Only an administrator can reset sample data.');
      const sample = seed();
      for (const table of TABLES.filter(name => name !== 'users')) {
        const snapshot = await firebaseDb.collection(table).get();
        for (let offset = 0; offset < snapshot.docs.length; offset += 450) {
          const batch = firebaseDb.batch();
          snapshot.docs.slice(offset, offset + 450).forEach(doc => batch.delete(doc.ref));
          await batch.commit();
        }
        const batch = firebaseDb.batch();
        sample[table].forEach(row => batch.set(firebaseDb.collection(table).doc(row.id), row));
        await batch.commit();
      }
    },
    onChange(callback) { listeners.add(callback); return () => listeners.delete(callback); }
  };
})();
