const { role, mode } = document.body.dataset;
const el = id => document.getElementById(id);

window.addEventListener('resqcoord:error', event => {
  const error = el('error');
  if (error) error.textContent = event.detail?.message || 'Firebase could not save the data.';
});

(async () => {
  await Auth.initialize();

  if (role === 'user' && mode === 'register') {
    el('team').innerHTML = DB.all('teams').map(team => `<option value="${team.id}">${team.name}</option>`).join('');
  }

  el('form').addEventListener('submit', async event => {
    event.preventDefault();
    el('error').textContent = '';
    const email = el('email').value.trim().toLowerCase();
    const password = el('password').value;
    try {
      if (mode === 'register') {
        const fields = {
          name: el('name').value.trim(),
          email,
          password,
          org: el('org')?.value.trim(),
          teamId: el('team')?.value
        };
        if (role === 'admin') {
          await Auth.requestAdmin(fields);
          el('error').textContent = 'Request submitted. The project owner must approve your account before administrator sign-in is enabled.';
          el('form').querySelector('button').disabled = true;
          return;
        }
        await Auth.register(role, fields);
      }
      await Auth.login(role, email, password);
      location.href = role === 'admin' ? 'admin-dashboard.html' : 'user-dashboard.html';
    } catch (error) {
      el('error').textContent = error.message || 'Firebase sign-in failed.';
    }
  });
})().catch(error => {
  console.error('Firebase initialization failed:', error);
  const message = el('error');
  if (message) message.textContent = error.message || 'Could not connect to Firebase.';
});
