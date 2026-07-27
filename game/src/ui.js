// HUD, world-space markers and narrative overlays.

import * as THREE from 'three';

const $ = (sel) => document.querySelector(sel);

export class UIManager {
  constructor() {
    this.menu = $('#menu');
    this.cinematic = $('#cinematic');
    this.result = $('#result');
    this.hud = $('#hud');
    this.reticle = $('#reticle');
    this.markerLayer = $('#marker-layer');
    this.comms = $('#comms');
    this.commsSpeaker = $('#comms-speaker');
    this.commsText = $('#comms-text');
    this.toastEl = $('#toast');
    this.banner = $('#banner');
    this.bannerTitle = $('#banner-title');
    this.bannerSub = $('#banner-sub');
    this.damageFlash = $('#damage-flash');

    this.el = {
      score: $('#score'), combo: $('#combo'),
      suki: $('#suki-bar'), eno: $('#eno-bar'),
      sukiNum: $('#suki-num'), enoNum: $('#eno-num'),
      weaponName: $('#weapon-name'), ammo: $('#ammo-count'),
      friendly: $('#friendly-count'), stand: $('#stand-label'),
      progress: $('#progress-fill'), weaponCard: $('#weapon-card')
    };

    this.markers = new Map();
    this.markerPool = [];
    this.screenPoint = { x: 0, y: 0 };
    this.commsTimer = null;
    this.toastTimer = null;
    this.bannerTimer = null;
  }

  setScreen(name) {
    this.menu.classList.toggle('show', name === 'menu');
    this.cinematic.classList.toggle('show', name === 'cinematic');
    this.result.classList.toggle('show', name === 'result');
    const playing = name === 'playing';
    this.hud.classList.toggle('show', playing);
    this.reticle.classList.toggle('show', playing);
    this.markerLayer.classList.toggle('show', playing);
    document.body.classList.toggle('playing', playing);
  }

  setMotionStatus(state, detail) {
    const el = $('#motion-status');
    if (!el) return;
    el.textContent = detail;
    el.dataset.state = state;
  }

  // --- Reticle --------------------------------------------------------------
  updateReticle(x, y, { locked, cooldown, empty }) {
    this.reticle.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    this.reticle.classList.toggle('locked', !!locked);
    this.reticle.classList.toggle('empty', !!empty);
    this.reticle.style.setProperty('--cooldown', String(cooldown ?? 0));
  }

  kickReticle() {
    this.reticle.classList.remove('kick');
    void this.reticle.offsetWidth;
    this.reticle.classList.add('kick');
  }

  // --- World markers --------------------------------------------------------
  #acquireMarker() {
    const marker = this.markerPool.pop() || (() => {
      const el = document.createElement('div');
      el.className = 'marker';
      el.innerHTML = '<i></i><span></span>';
      return el;
    })();
    this.markerLayer.append(marker);
    return marker;
  }

  #releaseMarker(marker) {
    marker.remove();
    if (this.markerPool.length < 24) this.markerPool.push(marker);
  }

  updateMarkers(actors, world, cameraPos) {
    const seen = new Set();
    const point = new THREE.Vector3();
    actors.forEach((actor) => {
      const revealed = actor.state !== 'hidden' && actor.state !== 'dead';
      if (!revealed) return;
      const isCivilian = !actor.hostile;
      const distance = actor.position.distanceTo(cameraPos);

      actor.aimPoint(point);
      point.y += actor.height * 0.42;
      world.projectToScreen(point, this.screenPoint);
      const offscreen = this.screenPoint.offscreen;

      // Civilians always flagged. Hostiles only when they are close enough to
      // be a threat, or outside the view cone where you cannot see them at all.
      const wants = isCivilian || offscreen || distance < 5.2;
      if (!wants) return;

      seen.add(actor);
      let marker = this.markers.get(actor);
      if (!marker) {
        marker = this.#acquireMarker();
        this.markers.set(actor, marker);
      }
      marker.classList.remove('hidden');

      const margin = 62;
      const x = Math.max(margin, Math.min(window.innerWidth - margin, this.screenPoint.x));
      const y = Math.max(margin + 90, Math.min(window.innerHeight - margin - 70, this.screenPoint.y));
      marker.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      marker.dataset.kind = isCivilian ? 'civilian' : 'danger';
      marker.dataset.edge = offscreen ? 'true' : 'false';
      const label = marker.querySelector('span');
      const text = isCivilian
        ? (offscreen ? 'CIVILIAN' : 'CIVILIAN · HOLD FIRE')
        : (offscreen ? 'THREAT' : 'CLOSING');
      if (label.textContent !== text) label.textContent = text;
    });

    this.markers.forEach((marker, actor) => {
      if (seen.has(actor)) return;
      this.#releaseMarker(marker);
      this.markers.delete(actor);
    });
  }

  clearMarkers() {
    this.markers.forEach((marker) => this.#releaseMarker(marker));
    this.markers.clear();
  }

  // --- HUD ------------------------------------------------------------------
  update(state) {
    this.el.score.textContent = state.score.toLocaleString();
    this.el.combo.textContent = `x${state.combo.toFixed(1)}`;
    this.el.suki.style.width = `${state.sukiHealth}%`;
    this.el.eno.style.width = `${state.enoHealth}%`;
    this.el.sukiNum.textContent = Math.ceil(state.sukiHealth);
    this.el.enoNum.textContent = Math.ceil(state.enoHealth);
    this.el.suki.classList.toggle('critical', state.sukiHealth <= 30);
    this.el.eno.classList.toggle('critical', state.enoHealth <= 30);
    this.el.weaponName.textContent = state.weaponName;
    const reserve = Number.isFinite(state.reserve) ? state.reserve : '∞';
    this.el.ammo.innerHTML = state.reloading
      ? '<em>RELOAD</em>'
      : `${state.ammo}<small>/${reserve}</small>`;
    this.el.weaponCard.classList.toggle('empty', state.ammo <= 0 && !state.reloading);
    this.el.weaponCard.classList.toggle('reloading', !!state.reloading);
    this.el.friendly.textContent = `${state.friendlyVictims}/${state.friendlyLimit}`;
    this.el.friendly.classList.toggle('warn', state.friendlyVictims > 0);
    this.el.stand.textContent = state.standTitle;
    this.el.progress.style.width = `${(state.standProgress * 100).toFixed(1)}%`;
  }

  showComms(speaker, text, duration = 4200) {
    this.commsSpeaker.textContent = speaker;
    this.commsText.textContent = text;
    this.comms.classList.add('show');
    clearTimeout(this.commsTimer);
    this.commsTimer = setTimeout(() => this.comms.classList.remove('show'), duration);
  }

  toast(text, duration = 1600) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), duration);
  }

  showBanner(title, subtitle, duration = 2200) {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = subtitle || '';
    this.banner.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.banner.classList.remove('show'), duration);
  }

  flashDamage(strength = 1) {
    this.damageFlash.style.setProperty('--flash', String(Math.min(1, strength)));
    this.damageFlash.classList.remove('hit');
    void this.damageFlash.offsetWidth;
    this.damageFlash.classList.add('hit');
  }

  showResult(won, state) {
    $('#result-title').textContent = won ? state.resultTitle : 'Mission Failed';
    $('#result-summary').innerHTML = state.resultSummary;
    $('#result-stats').innerHTML = [
      ['Score', state.score.toLocaleString()],
      ['Best streak', state.bestStreak],
      ['Infected down', state.kills],
      ['Civilians lost', `${state.friendlyVictims}/${state.friendlyLimit}`],
      ['Accuracy', `${Math.round(state.accuracy * 100)}%`]
    ].map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`).join('');
    $('#result-next').classList.toggle('hidden', !state.hasNextLevel || !won);
    this.result.dataset.outcome = won ? 'win' : 'loss';
  }
}
