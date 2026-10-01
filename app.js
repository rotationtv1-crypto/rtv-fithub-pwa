(() => {
  const apiBase = (window.RTV_CONFIG?.apiBase || '').replace(/\/$/, '');
  const walletKey = 'rtv-fithub-wallet-v1';
  const list = document.querySelector('#workout-list');
  const status = document.querySelector('#status');
  const count = document.querySelector('#coin-count');
  const installButton = document.querySelector('#install-button');
  let installPrompt;
  let workouts = [];

  function localWallet() {
    try {
      const saved = JSON.parse(localStorage.getItem(walletKey) || '{}');
      return {
        coins: Number.isSafeInteger(saved.coins) && saved.coins >= 0 ? saved.coins : 0,
        completions: saved.completions && typeof saved.completions === 'object' ? saved.completions : {}
      };
    } catch {
      return { coins: 0, completions: {} };
    }
  }

  function setStatus(message) { status.textContent = message; }

  function renderWallet(wallet) {
    count.textContent = `${wallet.coins} ${wallet.coins === 1 ? 'coin' : 'coins'}`;
    for (const workout of workouts) {
      const button = list.querySelector(`[data-workout-id="${workout.id}"]`);
      if (!button) continue;
      const finished = wallet.completions?.[workout.id] === new Date().toISOString().slice(0, 10);
      button.disabled = finished;
      button.textContent = finished ? 'Completed today ✓' : 'Complete workout';
    }
  }

  async function request(path, options) {
    const response = await fetch(`${apiBase}${path}`, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to connect to FitHub.');
    return data;
  }

  async function complete(workout) {
    try {
      let wallet;
      if (apiBase) {
        wallet = await request('/api/wallet', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workoutId: workout.id })
        });
      } else {
        wallet = localWallet();
        const today = new Date().toISOString().slice(0, 10);
        if (wallet.completions[workout.id] === today) return;
        wallet.completions[workout.id] = today;
        wallet.coins += workout.coins;
        localStorage.setItem(walletKey, JSON.stringify(wallet));
      }
      renderWallet(wallet);
      setStatus(`${workout.title} completed. +${workout.coins} demo coins!`);
    } catch (error) { setStatus(error.message || 'Could not save this workout.'); }
  }

  function renderWorkouts() {
    list.replaceChildren();
    for (const workout of workouts) {
      const card = document.createElement('article');
      card.className = 'card';
      const top = document.createElement('div');
      top.className = 'card-top';
      const category = document.createElement('span');
      category.className = 'tag';
      category.textContent = workout.category;
      const reward = document.createElement('span');
      reward.className = 'reward';
      reward.textContent = `+${workout.coins} coins`;
      top.append(category, reward);
      const title = document.createElement('h3');
      title.textContent = workout.title;
      const description = document.createElement('p');
      description.textContent = workout.description;
      const duration = document.createElement('span');
      duration.className = 'duration';
      duration.textContent = `◷ ${workout.duration}`;
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'View routine';
      const steps = document.createElement('ol');
      for (const step of workout.steps) {
        const item = document.createElement('li');
        item.textContent = step;
        steps.append(item);
      }
      details.append(summary, steps);
      const button = document.createElement('button');
      button.className = 'complete';
      button.type = 'button';
      button.dataset.workoutId = workout.id;
      button.textContent = 'Complete workout';
      button.addEventListener('click', () => complete(workout));
      card.append(top, title, description, duration, details, button);
      list.append(card);
    }
    document.querySelector('#session-count').textContent = `${workouts.length} workouts`;
  }

  async function init() {
    try {
      const response = await fetch('./workouts.json');
      if (!response.ok) throw new Error('Workouts are unavailable.');
      workouts = await response.json();
      renderWorkouts();
      renderWallet(apiBase ? await request('/api/wallet') : localWallet());
    } catch (error) { setStatus(error.message || 'Workouts are unavailable.'); }
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
  });
  installButton.addEventListener('click', async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = undefined;
    } else {
      setStatus('To install: open your browser menu and choose “Add to Home Screen” or “Install app”.');
    }
  });
  window.addEventListener('appinstalled', () => setStatus('FitHub is installed. Keep showing up!'));
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {
      setStatus('Offline support is unavailable in this browser.');
    }));
  }
  init();
})();
