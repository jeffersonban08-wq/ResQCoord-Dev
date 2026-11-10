(() => {
  const OWNER_UID = 'XtAHdNSQ2OfXFZikyjFh67O6MVw1';
  const loginPanel = document.getElementById('loginPanel');
  const dashboardPanel = document.getElementById('dashboardPanel');
  const loginForm = document.getElementById('loginForm');
  const error = document.getElementById('error');
  const status = document.getElementById('status');
  const requestsBody = document.getElementById('requests');
  const signInButton = document.getElementById('signInButton');
  const refreshButton = document.getElementById('refreshButton');
  const signOutButton = document.getElementById('signOutButton');

  function showMessage(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('error', isError);
  }

  function setSignedIn(user) {
    loginPanel.hidden = !!user;
    dashboardPanel.hidden = !user;
    document.getElementById('ownerEmail').textContent = user ? `Signed in as ${user.email || 'project owner'}` : '';
  }

  async function handleAuthState(user) {
    if (!user) {
      setSignedIn(null);
      return;
    }

    if (user.uid !== OWNER_UID) {
      setSignedIn(null);
      showMessage(error, 'This Firebase account is not authorized to use the owner dashboard.', true);
      await firebaseAuth.signOut();
      return;
    }

    setSignedIn(user);
    loadRequests();
  }

  function addCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.appendChild(cell);
    return cell;
  }

  function renderRequests(items) {
    requestsBody.replaceChildren();
    if (!items.length) {
      const row = document.createElement('tr');
      const cell = addCell(row, 'There are no pending requests.');
      cell.colSpan = 5;
      cell.className = 'muted';
      requestsBody.appendChild(row);
      return;
    }

    items.forEach(({ id, data }) => {
      const row = document.createElement('tr');
      addCell(row, data.name || '');
      addCell(row, data.org || '');
      addCell(row, data.email || '');
      const created = new Date(data.createdAt);
      addCell(row, Number.isNaN(created.getTime()) ? '' : created.toLocaleString());
      const actionCell = document.createElement('td');
      const button = document.createElement('button');
      button.className = 'btn small primary';
      button.textContent = 'Approve';
      button.addEventListener('click', () => approveRequest(id, button));
      actionCell.appendChild(button);
      row.appendChild(actionCell);
      requestsBody.appendChild(row);
    });
  }

  async function loadRequests() {
    refreshButton.disabled = true;
    showMessage(status, 'Loading requests…');
    try {
      const snapshot = await firebaseDb.collection('adminRequests')
        .where('status', '==', 'pending')
        .get();
      const items = snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));
      items.sort((a, b) => String(b.data.createdAt || '').localeCompare(String(a.data.createdAt || '')));
      renderRequests(items);
      showMessage(status, `${items.length} pending request${items.length === 1 ? '' : 's'}.`);
      return true;
    } catch (loadError) {
      console.error('Could not load administrator access requests:', loadError);
      showMessage(status, loadError.message || 'Could not load administrator access requests.', true);
      return false;
    } finally {
      refreshButton.disabled = false;
    }
  }

  async function approveRequest(requestId, button) {
    button.disabled = true;
    showMessage(status, 'Approving request…');
    try {
      const requestRef = firebaseDb.collection('adminRequests').doc(requestId);
      const requestSnapshot = await requestRef.get();
      if (!requestSnapshot.exists || requestSnapshot.data().status !== 'pending') {
        showMessage(status, 'This request is no longer pending. Refreshing the list.');
        await loadRequests();
        return;
      }

      const request = requestSnapshot.data();
      const batch = firebaseDb.batch();
      batch.set(firebaseDb.collection('users').doc(requestId), {
        id: requestId,
        role: 'admin',
        name: request.name,
        org: request.org,
        email: request.email,
        createdAt: new Date().toISOString()
      });
      batch.delete(requestRef);
      await batch.commit();
      if (await loadRequests()) {
        showMessage(status, `Approved ${request.email}. They can now sign in as an administrator.`);
      }
    } catch (approvalError) {
      console.error('Could not approve administrator access request:', approvalError);
      showMessage(status, approvalError.message || 'Could not approve this request.', true);
      button.disabled = false;
    }
  }

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    showMessage(error, '');
    signInButton.disabled = true;
    try {
      await firebaseAuth.signInWithEmailAndPassword(
        document.getElementById('email').value.trim(),
        document.getElementById('password').value
      );
    } catch (signInError) {
      console.error('Project owner sign-in failed:', signInError);
      showMessage(error, signInError.code === 'auth/invalid-credential'
        ? 'Wrong email or password.'
        : signInError.message || 'Could not sign in.', true);
    } finally {
      signInButton.disabled = false;
    }
  });

  refreshButton.addEventListener('click', loadRequests);
  signOutButton.addEventListener('click', async () => {
    try {
      await firebaseAuth.signOut();
      showMessage(error, '');
    } catch (signOutError) {
      console.error('Project owner sign-out failed:', signOutError);
      showMessage(status, signOutError.message || 'Could not sign out.', true);
    }
  });

  firebaseAuth.onAuthStateChanged(user => {
    handleAuthState(user).catch(authError => {
      console.error('Could not verify project owner account:', authError);
      setSignedIn(null);
      showMessage(error, authError.message || 'Could not verify owner account.', true);
    });
  }, authError => {
    console.error('Could not verify project owner sign-in:', authError);
    setSignedIn(null);
    showMessage(error, authError.message || 'Could not verify sign-in.', true);
  });
})();
