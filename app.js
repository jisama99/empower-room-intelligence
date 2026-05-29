/* ============================================================
   EMPOWER ROOM INTELLIGENCE V4.1 — app.js
   PWA Vanilla JS — Norton × Impact Sales Marketing
   Stack : Vanilla JS | Apps Script REST | Google Sheets
   ============================================================ */

'use strict';

/* ════════════════════════════════════════════
   1. CONFIG — SOURCE DE VÉRITÉ
════════════════════════════════════════════ */
const CONFIG = {
  APP_VERSION: '4.1',
  APP_NAME: 'EMPOWER ROOM INTELLIGENCE',
  FY: 'FY27',
  QUARTER_ACTIF: 'Q1',

  // URL de déploiement Apps Script — PRODUCTION
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxyKghAA5iD2BHOCbqFFr5HoLQCXlcyzSiey4MXHWGhCXh0VVY5kkceqTptjoA_lV6cDQ/exec',

  // Timeout appels API (ms)
  API_TIMEOUT: 12000,

  // ⚠️ Clé Groq : stockée uniquement dans Apps Script Script Properties
  // Ne jamais écrire la clé ici — proxy côté serveur uniquement

  // Session
  SESSION_DURATION_MS: 8 * 60 * 60 * 1000, // 8h

  // Anti-doublon
  SEUIL_ALERTE:  80,
  SEUIL_BLOCAGE: 95,

  // Rayon géoloc (km)
  RAYON_GEOLOC: 10,
};

/* ════════════════════════════════════════════
   2. UTILISATEURS & DROITS
════════════════════════════════════════════ */
const USERS = {
  1000: { nom: 'Tadjidine', prenom: 'Tadjidine', role: 'manager',    droits: ['all', 'exports', 'objectifs', 'bonus_manager', 'copil', 'note_privee'] },
  2000: { nom: 'Alexandra', prenom: 'Alexandra', role: 'directrice', droits: ['primes', 'exports', 'objectifs', 'copil', 'nsb', 'import_ca', 'leads_flavie', 'dashboard_complet', 'visite', 'note_privee'] },
  3000: { nom: 'Flavie',    prenom: 'Flavie',    role: 'flavie',     droits: ['flavie', 'read_pipeline'] },
  4001: { nom: 'Mehdi',     prenom: 'Mehdi',     role: 'cds',        droits: ['pipeline', 'visite', 'phoning', 'primes', 'tuto', 'note_privee'] },
  4002: { nom: 'Lyes',      prenom: 'Lyes',      role: 'cds',        droits: ['pipeline', 'visite', 'phoning', 'primes', 'tuto', 'note_privee'] },
  4003: { nom: 'Johanne',   prenom: 'Johanne',   role: 'cds',        droits: ['pipeline', 'visite', 'phoning', 'primes', 'tuto', 'note_privee'] },
};

// Objectifs FY27 — SOURCE DE VÉRITÉ (jamais modifier)
const OBJECTIFS_FY27 = {
  1000: { Q1: 12600, Q2: 7800,  Q3: 9200,  Q4: 12300, FY: 41900 },
  4002: { Q1: 7500,  Q2: 4700,  Q3: 5500,  Q4: 7300,  FY: 25000 },
  4001: { Q1: 4800,  Q2: 3000,  Q3: 3500,  Q4: 4700,  FY: 16000 },
  4003: { Q1: 4000,  Q2: 2500,  Q3: 2900,  Q4: 3900,  FY: 13300 },
};

// Noms CDS pour affichage
const CDS_LABELS = {
  4001: 'Mehdi', 4002: 'Lyes', 4003: 'Johanne',
};

/* ════════════════════════════════════════════
   3. STATE — État global de l'application
════════════════════════════════════════════ */
const STATE = {
  pin:         null,
  user:        null,
  loginTime:   null,
  // Données chargées depuis Apps Script
  comptes:     [],
  prospects:   [],
  actions:     [],
  kpi:         null,
  primes:      null,
  phoning:     null,
  notifs:      [],
  objectifsRevises: {},
  // Navigation
  currentRoute:  null,
  previousRoute: null,
  routeParams:   {},
  // Formulaire visite en cours
  visiteDraft:   null,
  visiteBlocActif: 1,
};

/* ════════════════════════════════════════════
   4. AUTH — Authentification PIN 6 chiffres
════════════════════════════════════════════ */
const Auth = {
  KEY_PIN:        'empower_pin',
  KEY_ROLE:       'empower_role',
  KEY_NOM:        'empower_nom',
  KEY_LOGIN_TIME: 'empower_login_time',
  KEY_TUTO_DONE:  'empower_tuto_done_',

  init() {
    const pin  = localStorage.getItem(this.KEY_PIN);
    const time = parseInt(localStorage.getItem(this.KEY_LOGIN_TIME) || '0', 10);

    if (pin && time && (Date.now() - time < CONFIG.SESSION_DURATION_MS)) {
      this._setSession(parseInt(pin, 10));
      return true;
    }
    this._clearSession();
    return false;
  },

  login(pin) {
    const p = parseInt(pin, 10);
    if (!USERS[p]) return false;
    this._setSession(p);
    return true;
  },

  logout() {
    this._clearSession();
    Router.navigate('/login');
  },

  _setSession(pin) {
    const user = USERS[pin];
    STATE.pin       = pin;
    STATE.user      = user;
    STATE.loginTime = parseInt(localStorage.getItem(this.KEY_LOGIN_TIME) || Date.now().toString(), 10);
    localStorage.setItem(this.KEY_PIN,       pin.toString());
    localStorage.setItem(this.KEY_ROLE,      user.role);
    localStorage.setItem(this.KEY_NOM,       user.prenom);
    localStorage.setItem(this.KEY_LOGIN_TIME, STATE.loginTime.toString());
  },

  _clearSession() {
    STATE.pin = null; STATE.user = null; STATE.loginTime = null;
    [this.KEY_PIN, this.KEY_ROLE, this.KEY_NOM, this.KEY_LOGIN_TIME]
      .forEach(k => localStorage.removeItem(k));
  },

  hasDroit(droit) {
    if (!STATE.user) return false;
    if (STATE.user.droits.includes('all')) return true;
    return STATE.user.droits.includes(droit);
  },

  // PIN 1000 = manager (validation finale, bonus, suppression physique)
  // PIN 2000 = directrice (dashboard complet, exports, objectifs co-validation, NSB, importCA)
  // isManager() → accès aux fonctions partagées 1000+2000 (exports, copil, NSB, objectifs)
  isManager()    { return STATE.pin === 1000 || STATE.pin === 2000; },
  isCDS()        { return [4001, 4002, 4003].includes(STATE.pin); },
  isFlavie()     { return STATE.pin === 3000; },
  isPin1000()    { return STATE.pin === 1000; },
  isAlexandra()  { return STATE.pin === 2000; },
  // canSupprimer → réservé manager PIN 1000 uniquement
  canSupprimer() { return STATE.pin === 1000; },
  // canModifierObj → 1000 complet, 2000 partiel (co-validation)
  canModifierObj() { return STATE.pin === 1000 || STATE.pin === 2000; },

  tutoFait() {
    return localStorage.getItem(this.KEY_TUTO_DONE + STATE.pin) === '1';
  },
  marquerTutoDone() {
    localStorage.setItem(this.KEY_TUTO_DONE + STATE.pin, '1');
  },

  getSessionRestante() {
    if (!STATE.loginTime) return 0;
    const reste = CONFIG.SESSION_DURATION_MS - (Date.now() - STATE.loginTime);
    return Math.max(0, Math.floor(reste / 60000)); // minutes
  },
};

/* ════════════════════════════════════════════
   5. ROUTER — SPA history.pushState
════════════════════════════════════════════ */
const Router = {
  ROUTES: {
    '/login':    { screen: 'login',    title: 'EMPOWER RI',    nav: false, back: false, auth: false },
    '/home':     { screen: 'home',     title: 'Accueil',        nav: true,  back: false, auth: true },
    '/pipeline': { screen: 'pipeline', title: 'Pipeline',       nav: true,  back: false, auth: true },
    '/compte':   { screen: 'compte',   title: 'Fiche compte',   nav: false, back: true,  auth: true },
    '/visite':   { screen: 'visite',   title: 'Visite Terrain', nav: false, back: true,  auth: true },
    '/phoning':  { screen: 'phoning',  title: 'Phoning',        nav: false, back: true,  auth: true },
    '/copil':    { screen: 'copil',    title: 'COPIL',          nav: false, back: true,  auth: true, requires: [1000, 2000] },
    '/flavie':   { screen: 'flavie',   title: 'Dashboard Leads',nav: false, back: true,  auth: true, requires: [3000, 2000] },
    '/primes':   { screen: 'primes',   title: 'Mes Primes',     nav: false, back: true,  auth: true },
    '/planning': { screen: 'planning', title: 'Planning',       nav: true,  back: false, auth: true },
    '/tuto':     { screen: 'tuto',     title: 'Tutoriel',       nav: false, back: true,  auth: true },
    '/profil':   { screen: 'profil',   title: 'Mon Profil',     nav: true,  back: false, auth: true },
  },

  init() {
    window.addEventListener('popstate', e => {
      const path = window.location.pathname.replace(/^\/empower-v4/, '') || '/login';
      this._load(path, e.state || {});
    });
    // Délégation clics nav
    document.getElementById('bottom-nav')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-route]');
      if (btn) this.navigate(btn.dataset.route);
    });
    // Délégation section-header links
    document.addEventListener('click', e => {
      const el = e.target.closest('[data-route]');
      if (el && !el.closest('.bottom-nav')) this.navigate(el.dataset.route);
    });
  },

  navigate(path, params = {}) {
    const base = path.split('?')[0];
    // Guard routes restreintes
    const route = this.ROUTES[base] || this.ROUTES['/home'];
    if (route.auth && !STATE.pin) { this._load('/login'); return; }
    if (route.requires && !route.requires.includes(STATE.pin)) {
      UI.toast('Accès non autorisé', 'danger'); return;
    }
    STATE.previousRoute = STATE.currentRoute;
    STATE.routeParams   = params;
    const fullPath = this._buildPath(path);
    window.history.pushState(params, '', fullPath);
    this._load(base, params);
  },

  _buildPath(path) {
    // Compatible GitHub Pages avec sous-dossier
    return path;
  },

  _load(path, params = {}) {
    const base  = path.split('/').slice(0, 2).join('/') || '/home';
    const route = this.ROUTES[base] || this.ROUTES['/home'];
    STATE.currentRoute = base;

    // Auth guard
    if (route.auth && !STATE.pin) { this._renderScreen('login', route); return; }

    // Topbar
    const topbar    = document.getElementById('topbar');
    const btnBack   = document.getElementById('btn-back');
    const titleEl   = document.getElementById('topbar-title');
    const actionsEl = document.getElementById('topbar-actions');

    if (base === '/login') {
      topbar.classList.add('hidden');
    } else {
      topbar.classList.remove('hidden');
      // Texte titre
      const titleTextEl = titleEl.querySelector('.topbar__title-text');
      if (titleTextEl) titleTextEl.textContent = route.title;
      else titleEl.textContent = route.title;
      // Logo Norton visible sur home + pipeline
      const nortonLogo = document.getElementById('topbar-norton-logo');
      if (nortonLogo) {
        nortonLogo.classList.toggle('hidden', !['/home', '/pipeline', '/copil'].includes(base));
      }
      actionsEl.innerHTML = '';
      btnBack.classList.toggle('hidden', !route.back);
      if (route.back) {
        btnBack.onclick = () => window.history.back();
      }
    }

    // Bottom nav
    const nav = document.getElementById('bottom-nav');
    nav.classList.toggle('hidden', !route.nav);
    nav.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.route === base);
    });

    this._renderScreen(route.screen, route, params);
  },

  _renderScreen(screenName, route, params = {}) {
    const tpl = document.getElementById(`tpl-${screenName}`);
    if (!tpl) { console.warn('[Router] Template manquant:', screenName); return; }

    const container = document.getElementById('screen-container');
    container.innerHTML = '';
    container.appendChild(tpl.content.cloneNode(true));

    // Scroll en haut
    container.scrollTo(0, 0);

    // Initialiser l'écran
    const init = Screens[screenName];
    if (init) init(params);
  },
};

/* ════════════════════════════════════════════
   6. API — Stubs Apps Script REST
   ▶ Remplacer chaque stub par un vrai appel
     après déploiement Apps Script.
   Structure appel : GET/POST CONFIG.APPS_SCRIPT_URL
   avec param action=<action> + payload JSON
════════════════════════════════════════════ */
const API = {

  // ─────────────────────────────────────────────────────────────────
  // API.call — Appel générique vers la Web App Apps Script
  //
  // RÈGLES RÉSEAU (production Apps Script) :
  //   1. `pin` + `action` TOUJOURS dans les query params (e.parameter)
  //      → _dispatch lit e.parameter pour l'auth, pas le body
  //   2. POST → Content-Type: text/plain;charset=UTF-8
  //      → évite le preflight CORS (OPTIONS) que Apps Script ne gère pas
  //      → Apps Script lit quand même e.postData.contents et on JSON.parse côté serveur
  //   3. redirect: 'follow' → suit la redirection Google auth transparente
  //   4. Les scalaires GET ne sont pas JSON.stringify'd
  //   5. Une erreur applicative { error: '...' } dans la réponse remonte comme exception
  // ─────────────────────────────────────────────────────────────────
  async call(action, payload = {}, method = 'GET') {
    try {
      const url = new URL(CONFIG.APPS_SCRIPT_URL);
      url.searchParams.set('action', action);
      // PIN systématiquement dans les query params — auth serveur obligatoire
      if (STATE.pin != null) url.searchParams.set('pin', STATE.pin);

      const opts = { method, redirect: 'follow' };

      if (method === 'GET') {
        // Paramètres scalaires directement dans l'URL (pas de JSON.stringify)
        Object.keys(payload).forEach(k => {
          const v = payload[k];
          if (v !== null && v !== undefined) url.searchParams.set(k, v);
        });
      } else {
        // text/plain → pas de preflight CORS | Apps Script lit e.postData.contents normalement
        opts.headers = { 'Content-Type': 'text/plain;charset=UTF-8' };
        opts.body    = JSON.stringify({ pin: STATE.pin, ...payload });
      }

      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT);
      const res        = await fetch(url.toString(), { ...opts, signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Remonter les erreurs applicatives Apps Script
      if (data && data.error) throw new Error(data.error);
      return data;
    } catch (err) {
      console.warn('[API] Erreur:', action, err.message);
      throw err;
    }
  },

  // ── COMPTES ──────────────────────────────
  /**
   * STUB → getComptes
   * Retourne la liste des comptes filtrée selon le PIN
   * Apps Script : action=getComptes&pin=4001
   */
  async getComptes(cdsPinFilter = null) {
    return API.call('getComptes', { pin: cdsPinFilter || STATE.pin });
  },

  /**
   * STUB → getCompteById
   * Apps Script : action=getCompteById&id=XXX
   */
  async getCompteById(id) {
    return API.call('getCompteById', { id });
  },

  /**
   * STUB → updateStatutCompte
   * Apps Script : action=updateStatutCompte POST { id, statut, pin }
   */
  async updateStatutCompte(id, statut) {
    return API.call('updateStatutCompte', { id, statut }, 'POST');
  },

  // ── PROSPECTS ────────────────────────────
  /**
   * STUB → getProspects
   */
  async getProspects() {
    return API.call('getProspects', { pin: STATE.pin });
  },

  /**
   * STUB → createProspect
   * Crée un prospect avec Origine selon règles métier :
   * Cold revendeur → Origine=Visite_terrain
   */
  async createProspect(data) {
    return API.call('createProspect', data, 'POST');
  },

  // ── VISITES ──────────────────────────────
  /**
   * STUB → addVisite
   * Enregistre une visite terrain (10 blocs) dans ACTIONS
   * Gère automatiquement :
   *  - Cold revendeur → création PROSPECTS Origine=Visite_terrain
   *  - EMPOWER Intéressé → NOTIFS Flavie J0 + rappel CDS J+3
   *  - Commande prise → suggestion 1re_commande + notif PIN 1000
   *  - Réceptivité ≥ 4 → Label_IA=CHAUD + priorité remontée
   */
  async addVisite(data) {
    return API.call('addVisite', data, 'POST');
  },

  // ── KPI / DASHBOARD ──────────────────────
  /**
   * STUB → getKPI
   * Retourne CA réel vs objectif pour le PIN courant + quarter actif
   */
  async getKPI() {
    return API.call('getKPI', { pin: STATE.pin, quarter: CONFIG.QUARTER_ACTIF });
  },

  // ── PRIMES ───────────────────────────────
  /**
   * STUB → getPrimes
   * Calcule AXE1/2/3 selon mécaniques INCENTIVES-FY27
   */
  async getPrimes(quarter = CONFIG.QUARTER_ACTIF) {
    return API.call('getPrimes', { pin: STATE.pin, quarter });
  },

  // ── PHONING ──────────────────────────────
  /**
   * STUB → getCompteurPhoning
   * Retourne nb appels semaine courante
   */
  async getCompteurPhoning() {
    return API.call('getCompteurPhoning', { pin: STATE.pin });
  },

  /**
   * STUB → addAppel
   */
  async addAppel(data) {
    return API.call('addAppel', data, 'POST');
  },

  // ── OBJECTIFS ────────────────────────────
  /**
   * STUB → getObjectifs
   * FALLBACK : Q_Obj_Révisé vide → Q_Obj_Initial
   */
  async getObjectifs() {
    // pin requis pour passer l'auth — même pour une action lecture globale
    return API.call('getObjectifs', { pin: STATE.pin });
  },

  /**
   * STUB → updateObjectif
   * PIN 1000/2000 uniquement — contrôlé côté Apps Script
   * Révision à 0 → blocage
   */
  async updateObjectif(cdsPin, quarter, valeur) {
    if (!Auth.canModifierObj()) throw new Error('Unauthorized');
    if (valeur <= 0) throw new Error('Révision à 0 interdite');
    // Alexandra (2000) → co-validation : la révision est enregistrée avec flag pending
    // Manager (1000)   → validation immédiate
    const co_validation = Auth.isAlexandra(); // true = nécessite confirmation PIN 1000
    // Production :
    return API.call('updateObjectif', { cds_pin: cdsPin, quarter, valeur, co_validation }, 'POST');
  },

  // ── EXPORTS ──────────────────────────────
  /**
   * STUB → exportPDF
   * PIN 1000/2000 uniquement
   * Apps Script génère PDF 4 pages COPIL
   */
  async exportPDF(quarter = CONFIG.QUARTER_ACTIF) {
    if (!Auth.isManager()) throw new Error('Unauthorized');
    return API.call('exportPDF', { quarter }, 'POST');
  },

  async exportExcel(quarter = CONFIG.QUARTER_ACTIF) {
    if (!Auth.isManager()) throw new Error('Unauthorized');
    return API.call('exportExcel', { quarter }, 'POST');
  },

  // ── IMPORT CA ────────────────────────────
  /**
   * importCA
   * Permet à Alexandra (2000) et au manager (1000) d'importer
   * un CA pour un compte donné (CA_Import_Total).
   * Journalisé dans LOGS (PIN + timestamp + action).
   */
  async importCA(compteId, montant, quarter) {
    if (!Auth.isManager()) throw new Error('Unauthorized — import CA réservé à 1000/2000');
    if (!compteId || montant <= 0) throw new Error('compteId et montant requis');
    return API.call('importCA', { compte_id: compteId, montant, quarter: quarter || CONFIG.QUARTER_ACTIF }, 'POST');
  },

  // ── NSB ──────────────────────────────────
  async getNSBCommandes() {
    return API.call('getNSBCommandes', { pin: STATE.pin });
  },
  async validerNSB(id) {
    return API.call('validerNSB', { id }, 'POST');
  },

  // ── NOTIFS ───────────────────────────────
  async getNotifs() {
    return API.call('getNotifs', { pin: STATE.pin });
  },

  // ── GROQ IA — Pipeline combiné (Whisper → Llama) via proxy Apps Script ──
  /**
   * groqAnalyse
   * Envoie le blob audio au backend Apps Script (action=groqAnalyse).
   * Le backend gère : Whisper transcription → Llama extraction 9 champs.
   * La clé Groq n'est JAMAIS exposée côté client.
   *
   * @param {Blob} audioBlob — audio/webm enregistré via MediaRecorder
   * @returns {{ ok: boolean, transcript: string, data: Object }}
   */
  async groqAnalyse(audioBlob) {
    // Convertit le blob en base64 pour transport JSON
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(audioBlob);
    });

    // URL construite proprement — pin + action dans query params (auth serveur)
    const url = new URL(CONFIG.APPS_SCRIPT_URL);
    url.searchParams.set('action', 'groqAnalyse');
    url.searchParams.set('pin', STATE.pin);

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 28000); // Whisper peut prendre 20–25s

    const res = await fetch(url.toString(), {
      method:   'POST',
      headers:  { 'Content-Type': 'text/plain;charset=UTF-8' }, // pas de preflight CORS
      redirect: 'follow',
      signal:   controller.signal,
      body:     JSON.stringify({
        audio_base64: base64,
        mime_type:    audioBlob.type || 'audio/webm',
        pin:          STATE.pin,
      }),
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`Erreur réseau : HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    if (!json.ok)   throw new Error('Réponse inattendue du serveur');
    return json; // { ok, transcript, data: {9 champs} }
  },

};

// Helpers state
function State_getComptesCDS() {
  if (Auth.isManager()) return STATE.comptes;
  return STATE.comptes.filter(c => c.cds === STATE.pin);
}

/* ════════════════════════════════════════════
   7. UI — Composants d'interface réutilisables
════════════════════════════════════════════ */
const UI = {

  toast(msg, type = 'default', duration = 3000) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => el.remove(), duration);
  },

  showLoader()  { document.getElementById('global-loader').classList.remove('hidden'); },
  hideLoader()  { document.getElementById('global-loader').classList.add('hidden'); },

  async withLoader(fn) {
    this.showLoader();
    try { return await fn(); }
    catch (e) { this.toast('Erreur : ' + e.message, 'danger'); throw e; }
    finally   { this.hideLoader(); }
  },

  /** Génère une card compte pour la liste pipeline */
  renderCompteCard(compte) {
    const div = document.createElement('div');
    div.className = `compte-card${compte.statut === 'Bloqué' ? ' compte-card--blocked' : ''}`;
    div.innerHTML = `
      <div class="compte-card__top">
        <div>
          <p class="compte-card__nom">${Utils.esc(compte.nom)}</p>
          <p class="compte-card__meta">${Utils.esc(compte.ville)} — ${Utils.esc(compte.segment)}</p>
        </div>
        <span class="chip-priorite chip-priorite--${compte.priorite}">${compte.priorite}</span>
      </div>
      <div class="compte-card__badges">
        <span class="chip-statut chip-statut--${compte.statut}">${compte.statut.replace(/_/g,' ')}</span>
        ${compte.empower !== 'NON' ? `<span class="chip chip--small">⭐ EMPOWER</span>` : ''}
      </div>
      <div class="compte-card__ca">CA : ${Utils.formatEur(compte.ca_terrain + compte.ca_import)} | Score : ${compte.score}/100</div>
    `;
    div.addEventListener('click', () => Router.navigate('/compte', { id: compte.id }));
    return div;
  },

  /** Ouvre une modale bottom-sheet */
  openModal(title, contentHTML, onConfirm = null) {
    document.querySelector('.modal-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal__header">
          <span class="modal__title">${Utils.esc(title)}</span>
          <button class="modal__close" id="modal-close">✕</button>
        </div>
        <div class="modal__body">${contentHTML}</div>
        ${onConfirm ? `<button class="btn btn--primary btn--full" id="modal-confirm">Confirmer</button>` : ''}
      </div>`;

    overlay.querySelector('#modal-close').onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    if (onConfirm) overlay.querySelector('#modal-confirm').onclick = () => { onConfirm(); overlay.remove(); };
    document.body.appendChild(overlay);
  },

  /** Chip statut colorée */
  statutChip(statut) {
    const el = document.createElement('span');
    el.className = `chip-statut chip-statut--${statut}`;
    el.textContent = statut.replace(/_/g, ' ');
    return el;
  },

  updateNavBadge(count) {
    const badge = document.getElementById('notif-count');
    if (!badge) return;
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  },
};

/* ════════════════════════════════════════════
   8. UTILS
════════════════════════════════════════════ */
const Utils = {
  esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },
  formatEur(val) {
    if (val == null || isNaN(val)) return '—';
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(val);
  },
  formatPct(val) {
    if (val == null || isNaN(val)) return '—%';
    return val.toFixed(1) + '%';
  },
  semaineISO() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const jan1 = new Date(d.getFullYear(), 0, 4);
    return Math.round(((d - jan1) / 86400000 + (jan1.getDay() + 6) % 7) / 7) + 1;
  },
  dateToday() {
    return new Date().toISOString().split('T')[0];
  },
  heureActuelle() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  },
  delay(ms) { return new Promise(r => setTimeout(r, ms)); },
  jaccardSim(a, b) {
    if (!a || !b) return 0;
    const setA = new Set(a.toLowerCase().split(/\W+/));
    const setB = new Set(b.toLowerCase().split(/\W+/));
    const inter = [...setA].filter(x => setB.has(x)).length;
    const union = new Set([...setA, ...setB]).size;
    return union === 0 ? 0 : Math.round((inter / union) * 100);
  },
  /** Progressbar fill color selon % */
  fillClass(pct) {
    if (pct >= 100) return 'progress-bar__fill--success';
    if (pct >= 80)  return '';
    return 'progress-bar__fill--danger';
  },
};

/* ════════════════════════════════════════════
   9. SCREENS — Un module par route
════════════════════════════════════════════ */
const Screens = {};

/* ── 9.1 LOGIN ── */
Screens.login = function() {
  let pinBuffer = [];

  function update() {
    document.querySelectorAll('.pin-dot').forEach((dot, i) => {
      dot.classList.toggle('filled', i < pinBuffer.length);
      dot.classList.remove('error');
    });
  }

  function _doPostLoginNavigation() {
    // Log de session côté Apps Script (silencieux, non bloquant)
    API.call('login', {}, 'POST').catch(() => {});
    if (Auth.isCDS() && !Auth.tutoFait()) {
      Router.navigate('/tuto');
    } else if (Auth.isPin1000() || STATE.pin === 2000) {
      Router.navigate('/copil');
    } else if (Auth.isFlavie()) {
      Router.navigate('/flavie');
    } else {
      Router.navigate('/home');
    }
  }

  function _showRgpdIfNeeded(callback) {
    if (localStorage.getItem('rgpd_ok')) { callback(); return; }
    const modal = document.getElementById('modal-rgpd');
    if (!modal) { callback(); return; }
    modal.classList.remove('hidden');
    document.getElementById('btn-rgpd-accept')?.addEventListener('click', () => {
      localStorage.setItem('rgpd_ok', '1');
      modal.classList.add('hidden');
      callback();
    }, { once: true });
    document.getElementById('btn-rgpd-decline')?.addEventListener('click', () => {
      // Accès accordé mais géoloc/audio désactivés (flag pour les blocs concernés)
      localStorage.setItem('rgpd_ok', 'partial');
      modal.classList.add('hidden');
      callback();
    }, { once: true });
  }

  function tryLogin() {
    const pin = pinBuffer.join('');
    if (Auth.login(parseInt(pin, 10))) {
      _showRgpdIfNeeded(_doPostLoginNavigation);
    } else {
      document.querySelectorAll('.pin-dot').forEach(d => d.classList.add('error'));
      document.getElementById('login-error').classList.remove('hidden');
      pinBuffer = [];
      setTimeout(() => {
        document.querySelectorAll('.pin-dot').forEach(d => d.classList.remove('error','filled'));
        document.getElementById('login-error').classList.add('hidden');
      }, 1200);
    }
  }

  document.querySelectorAll('.pin-key[data-digit]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (pinBuffer.length >= 6) return;
      pinBuffer.push(btn.dataset.digit);
      update();
      if (pinBuffer.length === 6) setTimeout(tryLogin, 100);
    });
  });

  document.getElementById('pin-delete')?.addEventListener('click', () => {
    pinBuffer.pop(); update();
    document.getElementById('login-error').classList.add('hidden');
  });
};

/* ── 9.2 HOME ── */
Screens.home = async function() {
  document.getElementById('home-nom').textContent = STATE.user?.prenom || '—';

  // Charger KPI
  try {
    const kpi = await API.getKPI();
    STATE.kpi = kpi;
    const pct = kpi.pct || 0;

    document.getElementById('kpi-quarter-label').textContent = `${kpi.quarter} ${kpi.fy}`;
    document.getElementById('kpi-quarter-pct').textContent = `${pct}%`;
    document.getElementById('kpi-ca-reel').textContent = Utils.formatEur(kpi.reel);
    document.getElementById('kpi-ca-obj').textContent  = Utils.formatEur(kpi.obj);
    const gap = kpi.reel - kpi.obj;
    const gapEl = document.getElementById('kpi-ca-gap');
    gapEl.textContent = (gap >= 0 ? '+' : '') + Utils.formatEur(gap);
    gapEl.style.color = gap >= 0 ? 'var(--success)' : 'var(--danger)';

    const fill = document.getElementById('kpi-progress-fill');
    fill.style.width = `${Math.min(pct, 100)}%`;
    fill.className = `progress-bar__fill ${Utils.fillClass(pct)}`;

    document.getElementById('stat-comptes').textContent = kpi.comptes;
    document.getElementById('stat-visites').textContent = kpi.visites;
    document.getElementById('stat-nsb').textContent     = kpi.nsb;
    document.getElementById('stat-appels').textContent  = kpi.appels_semaine;
  } catch { /* silence */ }

  // Primes
  try {
    const primes = await API.getPrimes();
    STATE.primes = primes;
    document.getElementById('prime-axe1').textContent = primes.axe1 + '€';
    document.getElementById('prime-axe2').textContent = primes.axe2 + '€';
    const axe3 = primes.axe3a + primes.axe3b;
    document.getElementById('prime-axe3').textContent = axe3 + '€';
  } catch { /* silence */ }

  // Phoning
  try {
    const phoning = await API.getCompteurPhoning();
    document.getElementById('phoning-count').textContent = phoning.nb_appels;
  } catch { /* silence */ }

  // Notifs
  try {
    const notifs = await API.getNotifs();
    UI.updateNavBadge(notifs.length);
  } catch { /* silence */ }
};

/* ── 9.3 PIPELINE ── */
Screens.pipeline = async function() {
  let comptes  = [];
  let filtreStatut = 'all';
  let filtreCDS    = 'all';
  let recherche    = '';

  // Afficher filtre CDS uniquement pour manager
  if (Auth.isManager()) {
    document.getElementById('filter-cds-wrap').classList.remove('hidden');
  }

  // Charger comptes
  try {
    comptes = await API.getComptes();
    STATE.comptes = comptes;
  } catch {
    UI.toast('Impossible de charger les comptes', 'danger');
  }

  function render() {
    let list = [...comptes];

    // Filtres
    if (filtreStatut !== 'all') list = list.filter(c => c.statut === filtreStatut);
    if (filtreCDS !== 'all')    list = list.filter(c => c.cds === parseInt(filtreCDS));
    if (recherche)              list = list.filter(c => c.nom.toLowerCase().includes(recherche.toLowerCase()));

    document.getElementById('pipeline-count').textContent = `${list.length} compte${list.length > 1 ? 's' : ''}`;

    const container = document.getElementById('compte-list');
    container.innerHTML = '';
    if (list.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state__icon">🔍</div><p>Aucun compte trouvé</p></div>';
      return;
    }
    list.forEach(c => container.appendChild(UI.renderCompteCard(c)));
  }

  // Filtres statut
  document.getElementById('filter-chips').addEventListener('click', e => {
    const chip = e.target.closest('.chip[data-filter]');
    if (!chip) return;
    document.querySelectorAll('#filter-chips .chip').forEach(c => c.classList.remove('chip--active'));
    chip.classList.add('chip--active');
    filtreStatut = chip.dataset.filter;
    render();
  });

  // Filtre CDS
  document.getElementById('filter-cds')?.addEventListener('change', e => {
    filtreCDS = e.target.value;
    render();
  });

  // Recherche
  document.getElementById('pipeline-search')?.addEventListener('input', e => {
    recherche = e.target.value;
    render();
  });

  // Bouton cold visite
  document.getElementById('btn-cold-visit')?.addEventListener('click', () => {
    STATE.visiteDraft = { source: 'cold_revendeur' };
    Router.navigate('/visite');
  });

  render();
};

/* ── 9.4 COMPTE (fiche) ── */
Screens.compte = async function(params) {
  const id = params?.id || null;
  if (!id) { Router.navigate('/pipeline'); return; }

  let compte = null;
  try {
    compte = await API.getCompteById(id);
  } catch { /* silence */ }

  if (!compte) {
    UI.toast('Compte introuvable', 'danger');
    Router.navigate('/pipeline');
    return;
  }

  // Header
  document.getElementById('compte-nom').textContent   = compte.nom;
  document.getElementById('compte-ville').textContent = compte.ville;
  const statutEl = document.getElementById('compte-statut-chip');
  statutEl.textContent  = compte.statut.replace(/_/g,' ');
  statutEl.className    = `chip-statut chip-statut--${compte.statut}`;
  const prioriteEl = document.getElementById('compte-priorite-chip');
  prioriteEl.textContent = compte.priorite;
  prioriteEl.className   = `chip-priorite chip-priorite--${compte.priorite}`;

  // CA
  document.getElementById('ca-terrain-val').textContent = Utils.formatEur(compte.ca_terrain);
  document.getElementById('ca-import-val').textContent  = Utils.formatEur(compte.ca_import);
  document.getElementById('ca-total-val').textContent   = Utils.formatEur(compte.ca_terrain + compte.ca_import);

  // Import CA : visible PIN 1000/2000
  document.getElementById('btn-import-ca').classList.toggle('hidden', !Auth.isManager());

  // Infos
  document.getElementById('compte-segment').textContent = compte.segment || '—';
  document.getElementById('compte-siret').textContent   = compte.siret   || '—';
  document.getElementById('compte-cds').textContent     = CDS_LABELS[compte.cds] || '—';
  document.getElementById('compte-origine').textContent = compte.origine  || '—';
  document.getElementById('compte-empower').textContent = compte.empower  || '—';
  document.getElementById('compte-score').textContent   = `${compte.score}/100`;
  document.getElementById('compte-next-action').textContent = compte.prochaine_action || '—';

  // Flags
  if (compte.flag_1re_cmd) document.getElementById('flag-1re-cmd').classList.add('active--cmd');
  if (compte.flag_nsb)     document.getElementById('flag-nsb').classList.add('active--nsb');

  // Note privée : visible CDS propriétaire + PIN 1000
  const noteCard = document.getElementById('note-privee-card');
  if (Auth.isPin1000() || compte.cds === STATE.pin) {
    noteCard.classList.remove('hidden');
    document.getElementById('note-privee-text').textContent = compte.note_privee || 'Aucune note privée';
  }

  // Boutons actions
  document.getElementById('btn-saisir-visite')?.addEventListener('click', () => {
    STATE.visiteDraft = { source: 'base_historique', compte_id: id, compte_nom: compte.nom };
    Router.navigate('/visite');
  });

  document.getElementById('btn-appeler')?.addEventListener('click', () => {
    if (compte.tel) window.open(`tel:${compte.tel}`);
    else UI.toast('Aucun numéro de téléphone renseigné', 'warning');
  });

  document.getElementById('btn-modifier-statut')?.addEventListener('click', () => {
    // Flavie → lecture seule
    if (Auth.isFlavie()) { UI.toast('Mode lecture seule', 'warning'); return; }
    const opts = ['A_contacter','En_discussion','Compte_créé','Actif','1re_commande','Intégré','Bloqué'];
    const optHTML = opts.map(o => `<button class="btn btn--secondary btn--full mb-8" data-statut="${o}">${o.replace(/_/g,' ')}</button>`).join('');
    UI.openModal('Modifier le statut', optHTML);
    setTimeout(() => {
      document.querySelectorAll('[data-statut]').forEach(btn => {
        btn.addEventListener('click', async () => {
          document.querySelector('.modal-overlay')?.remove();
          await API.updateStatutCompte(id, btn.dataset.statut);
          UI.toast('Statut mis à jour', 'success');
          Screens.compte(params); // refresh
        });
      });
    }, 100);
  });
};

/* ── 9.5 VISITE TERRAIN (formulaire 10 blocs) ── */
Screens.visite = function(params) {
  let bloc = 1;
  const data = STATE.visiteDraft || {};
  STATE.visiteDraft = data;
  STATE.visiteBlocActif = 1;

  // Pré-remplir depuis draft
  if (data.source) {
    const srcSel = document.getElementById('v-source');
    if (srcSel) srcSel.value = data.source;
    showSourceFields(data.source);
  }

  // Date/heure par défaut
  const dateInp = document.getElementById('v-date');
  const heureInp = document.getElementById('v-heure');
  if (dateInp && !dateInp.value)  dateInp.value  = Utils.dateToday();
  if (heureInp && !heureInp.value) heureInp.value = Utils.heureActuelle();

  function showBloc(n) {
    document.querySelectorAll('.visite-bloc').forEach((b, i) => {
      b.classList.toggle('hidden', i + 1 !== n);
    });
    document.getElementById('stepper-fill').style.width = `${(n / 10) * 100}%`;
    document.getElementById('stepper-label').textContent = `Bloc ${n}/10 — ${getBlocLabel(n)}`;
    document.getElementById('visite-step-indicator').textContent = `${n}/10`;
    document.getElementById('btn-bloc-prev').disabled = n === 1;

    // Dernier bloc
    const isLast = n === 10;
    document.getElementById('btn-bloc-next').classList.toggle('hidden', isLast);
    document.getElementById('visite-submit-wrap').classList.toggle('hidden', !isLast);
  }

  function getBlocLabel(n) {
    const labels = ['Identification','Profil Revendeur','Objectifs','Checklist','Freins','Concurrents','Grossistes','Résultat','Médias & IA','Marketing PDV'];
    return labels[n - 1] || '';
  }

  // Navigation blocs
  document.getElementById('btn-bloc-next')?.addEventListener('click', () => {
    if (!validateBloc(bloc)) return;
    collectBloc(bloc);
    if (bloc < 10) { bloc++; showBloc(bloc); }
  });
  document.getElementById('btn-bloc-prev')?.addEventListener('click', () => {
    if (bloc > 1) { bloc--; showBloc(bloc); }
  });

  // ── BLOC 1 : Source ──
  function showSourceFields(source) {
    document.getElementById('typeahead-historique-wrap').classList.toggle('hidden', source !== 'base_historique');
    document.getElementById('typeahead-prospect-wrap').classList.toggle('hidden', source !== 'prospect_existant');
    document.getElementById('cold-revendeur-wrap').classList.toggle('hidden', source !== 'cold_revendeur');
  }

  document.getElementById('v-source')?.addEventListener('change', e => {
    showSourceFields(e.target.value);
  });

  // Typeahead base historique
  const thHist = document.getElementById('typeahead-historique');
  thHist?.addEventListener('input', async () => {
    const q = thHist.value.trim();
    if (q.length < 2) return;
    const comptes = await API.getComptes();
    const results = comptes.filter(c => c.nom.toLowerCase().includes(q.toLowerCase()));
    renderTypeaheadResults('typeahead-hist-results', results, 'nom', compte => {
      thHist.value = compte.nom;
      data.compte_id  = compte.id;
      data.compte_nom = compte.nom;
      document.getElementById('typeahead-hist-results').classList.add('hidden');
      UI.toast(`Compte sélectionné : ${compte.nom}`, 'success');
    });
  });

  // Typeahead prospects (anti-doublon)
  const thProsp = document.getElementById('typeahead-prospect');
  thProsp?.addEventListener('input', async () => {
    const q = thProsp.value.trim();
    if (q.length < 2) return;
    const prospects = await API.getProspects();
    const results = prospects.filter(p => p.nom.toLowerCase().includes(q.toLowerCase()));
    // Anti-doublon : calcul similarité Jaccard
    const comptes = await API.getComptes();
    comptes.forEach(c => {
      const pct = Utils.jaccardSim(q, c.nom);
      if (pct >= CONFIG.SEUIL_ALERTE) {
        document.getElementById('doublon-pct').textContent = pct;
        document.getElementById('alert-doublon').classList.remove('hidden');
        if (pct >= CONFIG.SEUIL_BLOCAGE) {
          UI.toast(`⛔ Doublon détecté à ${pct}% — création bloquée`, 'danger');
        }
      }
    });
    renderTypeaheadResults('typeahead-prosp-results', results, 'nom', p => {
      thProsp.value   = p.nom;
      data.prospect_id = p.id;
      document.getElementById('typeahead-prosp-results').classList.add('hidden');
    });
  });

  function renderTypeaheadResults(containerId, items, labelKey, onSelect) {
    const cont = document.getElementById(containerId);
    if (!cont) return;
    cont.innerHTML = '';
    if (items.length === 0) { cont.classList.add('hidden'); return; }
    cont.classList.remove('hidden');
    items.slice(0, 8).forEach(item => {
      const div = document.createElement('div');
      div.className = 'typeahead-item';
      div.textContent = item[labelKey];
      div.addEventListener('click', () => onSelect(item));
      cont.appendChild(div);
    });
  }

  // GPS
  document.getElementById('btn-gps')?.addEventListener('click', () => {
    const statusEl = document.getElementById('gps-status');
    statusEl.textContent = '📡 Localisation…';
    navigator.geolocation?.getCurrentPosition(
      pos => {
        data.lat = pos.coords.latitude;
        data.lng = pos.coords.longitude;
        statusEl.textContent = `✅ ${data.lat.toFixed(4)}, ${data.lng.toFixed(4)}`;
        document.getElementById('btn-proximite').classList.remove('hidden');
      },
      () => { statusEl.textContent = '❌ Accès refusé'; }
    );
  });

  // GPS — Voisins à proximité
  document.getElementById('btn-proximite')?.addEventListener('click', async () => {
    if (!data.lat || !data.lng) return UI.toast('GPS non disponible', 'error');
    UI.showSpinner('Recherche voisins…');
    try {
      const voisins = await API.call('getVoisins', { lat: data.lat, lng: data.lng, rayon: CONFIG.RAYON_GEOLOC }, 'GET');
      const list = Array.isArray(voisins) ? voisins : (voisins.data || []);
      if (!list.length) { UI.toast('Aucun revendeur trouvé dans ce rayon', 'info'); return; }
      const html = list.map(v =>
        `<div class="card card--sm" style="margin:4px 0;padding:10px 12px;cursor:pointer;" data-id="${v.id||''}" data-nom="${v.nom||v.name||''}">
          <strong>${v.nom || v.name || '—'}</strong> · ${v.ville || v.city || ''}
          <span style="float:right;font-size:.75rem;color:var(--text-muted)">${v.distance ? v.distance.toFixed(1)+'km' : ''}</span>
        </div>`
      ).join('');
      const wrap = document.getElementById('voisins-results') || (() => {
        const d = document.createElement('div');
        d.id = 'voisins-results';
        d.style.cssText = 'margin-top:12px;max-height:260px;overflow-y:auto;';
        document.getElementById('btn-proximite').insertAdjacentElement('afterend', d);
        return d;
      })();
      wrap.innerHTML = `<p style="font-size:.8rem;color:var(--text-muted);margin-bottom:6px">${list.length} revendeur(s) dans un rayon de ${CONFIG.RAYON_GEOLOC} km</p>${html}`;
      wrap.querySelectorAll('.card--sm').forEach(card => {
        card.addEventListener('click', () => {
          const nom = card.dataset.nom;
          const id  = card.dataset.id;
          document.getElementById('source-nom-input').value = nom;
          data.source_id  = id;
          data.source_nom = nom;
          wrap.innerHTML = `<p style="font-size:.8rem;color:var(--success)">✅ Sélectionné : ${nom}</p>`;
          UI.toast(`Revendeur sélectionné : ${nom}`, 'success');
        });
      });
    } catch(e) {
      UI.toast('Erreur recherche voisins', 'error');
    } finally {
      UI.hideSpinner();
    }
  });

  // ── BLOC 4 : EMPOWER arbre ──
  document.querySelectorAll('#chips-empower-interet .chip--coral-select')?.forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('empower-partenaire-wrap').classList.toggle('hidden', btn.dataset.val !== 'OUI_deja_partenaire');
      document.getElementById('empower-non-wrap').classList.toggle('hidden', btn.dataset.val !== 'NON');
      if (btn.dataset.val === 'OUI_interesse') {
        document.getElementById('alert-empower-interesse').classList.remove('hidden');
      }
    });
  });

  // ── BLOC 5 : Contre-argument compteur ──
  document.getElementById('v-contre-argument')?.addEventListener('input', function() {
    document.getElementById('ca-count').textContent = this.value.length;
  });

  // ── BLOC 6 : Concurrents → afficher détail ──
  document.getElementById('chips-concurrents')?.addEventListener('click', () => {
    const selected = document.querySelectorAll('#chips-concurrents .chip--coral-select.selected');
    const hasConcurrent = [...selected].some(c => c.dataset.val !== 'Aucun');
    document.getElementById('concurrent-detail-wrap').classList.toggle('hidden', !hasConcurrent);
  });

  // Slider part linéaire
  const sliderPL = document.getElementById('v-part-lineaire');
  sliderPL?.addEventListener('input', function() {
    document.getElementById('v-part-lineaire-val').textContent = this.value;
    const pct = parseInt(this.value);
    this.style.background = `linear-gradient(to right, var(--coral) 0%, var(--coral) ${pct}%, var(--border) ${pct}%)`;
  });

  // ── BLOC 8 : Résultat → alertes ──
  document.getElementById('chips-resultat')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-val]');
    if (!btn) return;
    document.getElementById('alert-absent').classList.toggle('hidden', btn.dataset.val !== 'Absent');
    if (btn.dataset.val === 'Absent') {
      const d = new Date(); d.setDate(d.getDate() + 7);
      document.getElementById('v-prochaine-date').value = d.toISOString().split('T')[0];
    }
  });

  // Slider réceptivité
  const sliderRec = document.getElementById('v-receptivite');
  sliderRec?.addEventListener('input', function() {
    const v = parseInt(this.value);
    document.getElementById('receptivite-val').textContent = v;
    document.getElementById('label-chaud').classList.toggle('hidden', v < 4);
    const pct = ((v - 1) / 4) * 100;
    this.style.background = `linear-gradient(to right, var(--coral) 0%, var(--coral) ${pct}%, var(--border) ${pct}%)`;
  });

  // Contact direct toggle
  document.getElementById('toggle-contact-direct')?.addEventListener('change', function() {
    document.getElementById('contact-direct-wrap').classList.toggle('hidden', !this.checked);
  });

  // ── BLOC 8 : Commande prise ──
  document.getElementById('check-commande')?.addEventListener('change', function() {
    document.getElementById('alert-commande').classList.toggle('hidden', !this.checked);
    if (this.checked) {
      document.getElementById('v-statut-empower').value = '1re_commande';
    }
  });

  // ── BLOC 9 : Photo ──
  document.getElementById('btn-prendre-photo')?.addEventListener('click', () => {
    document.getElementById('input-photo').click();
  });
  document.getElementById('btn-importer-photo')?.addEventListener('click', () => {
    const inp = document.getElementById('input-photo');
    inp.removeAttribute('capture');
    inp.click();
  });
  document.getElementById('input-photo')?.addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const preview = document.getElementById('photo-preview');
      document.getElementById('photo-preview-img').src = e.target.result;
      preview.classList.remove('hidden');
      data.photo_base64 = e.target.result;
    };
    reader.readAsDataURL(file);
  });

  // Note privée : visible CDS + PIN 1000
  const noteForm = document.getElementById('note-privee-form');
  if (!Auth.isCDS() && !Auth.isPin1000()) {
    noteForm?.classList.add('hidden');
  }
  document.getElementById('v-note-privee')?.addEventListener('input', function() {
    document.getElementById('np-count').textContent = this.value.length;
  });

  // ── BLOC 9 : IA Groq — State machine (idle → recording → analysing → done/error) ──
  (function _initIAGroq() {
    const btnDicter   = document.getElementById('btn-dicter');
    const statusEl    = document.getElementById('ia-status');
    const statusTxt   = document.getElementById('ia-status-text');
    if (!btnDicter) return;

    // Injection dynamique : bouton stop + timer + transcript display
    const iaCard = btnDicter.closest('.card--ia') || btnDicter.parentElement;
    btnDicter.insertAdjacentHTML('afterend', `
      <button class="btn btn--secondary btn--full hidden" id="btn-stop-ia">
        ⏹ Arrêter l'enregistrement
      </button>
      <div class="ia-timer hidden" id="ia-timer" style="text-align:center;font-size:1.4rem;font-weight:700;color:var(--danger);margin-top:8px;">
        <span id="ia-timer-val">30</span>s
      </div>
      <div class="ia-transcript hidden" id="ia-transcript" style="margin-top:12px;padding:10px 12px;background:var(--bg);border-radius:8px;font-size:.85rem;color:var(--text-muted);border-left:3px solid var(--success);">
        <strong>Transcription :</strong> <span id="ia-transcript-text"></span>
      </div>
    `);

    const btnStop     = document.getElementById('btn-stop-ia');
    const timerEl     = document.getElementById('ia-timer');
    const timerVal    = document.getElementById('ia-timer-val');
    const transcriptEl = document.getElementById('ia-transcript');
    const transcriptTxt = document.getElementById('ia-transcript-text');

    let mediaRecorder  = null;
    let audioChunks    = [];
    let timerInterval  = null;
    let stopResolve    = null;   // résout la promesse d'arrêt manuel

    // ── setState : mise à jour UI selon l'état courant ──
    function setState(state, msg) {
      statusTxt.textContent = msg || '';
      btnDicter.classList.toggle('hidden', state !== 'idle');
      btnStop.classList.toggle('hidden',   state !== 'recording');
      statusEl.classList.toggle('hidden',  state === 'idle' || state === 'done' || state === 'error');
      timerEl.classList.toggle('hidden',   state !== 'recording');
      if (state === 'idle') { timerVal.textContent = '30'; transcriptEl.classList.add('hidden'); }
    }

    // ── Démarrer l'enregistrement ──
    btnDicter.addEventListener('click', async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        UI.toast('Microphone non disponible sur cet appareil', 'danger');
        return;
      }
      setState('recording', '');

      // Countdown 30s
      let secondes = 30;
      timerVal.textContent = secondes;
      timerInterval = setInterval(() => {
        secondes--;
        timerVal.textContent = secondes;
        if (secondes <= 0) _stopRecording();
      }, 1000);

      let stream;
      try {
        stream      = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg' });
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.start(250); // collecte toutes les 250ms
      } catch (err) {
        clearInterval(timerInterval);
        setState('error');
        UI.toast('Accès microphone refusé : ' + err.message, 'danger');
        setState('idle');
        return;
      }

      // Promesse arrêt (manuel ou auto)
      await new Promise(resolve => { stopResolve = resolve; });

      // Arrêt propre du stream
      clearInterval(timerInterval);
      if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      stream.getTracks().forEach(t => t.stop());
      await new Promise(r => { mediaRecorder.onstop = r; });

      const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });

      // ── Phase analyse ──
      setState('analysing', '🎙 Transcription Whisper…');
      try {
        const resp = await API.groqAnalyse(audioBlob);

        // Afficher la transcription brute
        transcriptTxt.textContent = resp.transcript || '—';
        transcriptEl.classList.remove('hidden');

        // Pré-remplir les champs BLOC 8
        setState('analysing', '🧠 Remplissage des champs…');
        const filled = _preRemplirDepuisIA(resp.data || {});

        setState('done');
        UI.toast(
          filled > 0
            ? `✅ ${filled} champ${filled > 1 ? 's' : ''} pré-rempli${filled > 1 ? 's' : ''} par l'IA`
            : '⚠️ Transcription OK — aucun champ extrait',
          filled > 0 ? 'success' : 'warning'
        );

        // Logger côté front (le backend logue aussi, ceci est un log local)
        console.info('[C3 IA] groqAnalyse OK', { pin: STATE.pin, filled, transcript: resp.transcript });

      } catch (err) {
        setState('error');
        UI.toast('Erreur IA : ' + err.message, 'danger');
      } finally {
        setState('idle');
      }
    });

    // ── Arrêt manuel ──
    btnStop.addEventListener('click', _stopRecording);
    function _stopRecording() {
      if (stopResolve) { stopResolve(); stopResolve = null; }
    }

  })();

  /**
   * _preRemplirDepuisIA
   * Mappe le JSON 9 champs → champs BLOC 8.
   * Règle : ne jamais écraser un champ déjà rempli sans validation.
   * Retourne le nombre de champs effectivement renseignés.
   *
   * Champs JSON attendus :
   *   resultat, receptivite, interlocuteur_nom, interlocuteur_prenom,
   *   interlocuteur_fonction, prochaine_action, date_action,
   *   frein_principal, interet_empower
   */
  function _preRemplirDepuisIA(d) {
    if (!d || typeof d !== 'object') return 0;
    let filled = 0;

    // Utilitaire : setter sécurisé (ne touche pas un champ déjà rempli)
    function _set(id, val) {
      if (!val && val !== 0) return;
      const el = document.getElementById(id);
      if (!el) return;
      const empty = el.value === '' || el.value == null || (el.tagName === 'INPUT' && el.type === 'range' && el.value === el.defaultValue);
      if (!empty) return; // champ déjà rempli → on ne touche pas
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      filled++;
    }

    // Utilitaire : chip exclusive (ne sélectionne que si aucun chip déjà actif)
    function _chip(containerId, val) {
      if (!val) return;
      const container = document.getElementById(containerId);
      if (!container) return;
      const alreadySelected = container.querySelector('.chip.selected');
      if (alreadySelected) return; // déjà un choix utilisateur
      const target = container.querySelector(`[data-val="${val}"]`);
      if (target) { target.classList.add('selected'); filled++; }
    }

    // 1. Résultat de visite (chip)
    _chip('chips-resultat', d.resultat);

    // 2. Réceptivité (slider)
    _set('v-receptivite', d.receptivite);

    // 3. Interlocuteur
    _set('v-interlocuteur-prenom',  d.interlocuteur_prenom);
    _set('v-interlocuteur-nom',     d.interlocuteur_nom);
    _set('v-interlocuteur-fonction',d.interlocuteur_fonction);

    // 4. Prochaine action + date
    _set('v-prochaine-action', d.prochaine_action);
    _set('v-prochaine-date',   d.date_action);

    // 5. Frein principal (texte libre — si le champ frein existe dans le BLOC 7)
    //    ID cible : v-frein-principal (peut être absent si BLOC 7 non ouvert)
    _set('v-frein-principal', d.frein_principal);

    // 6. Intérêt EMPOWER (chip)
    //    Mapping : interet_empower → chips-empower-interet data-val
    _chip('chips-empower-interet', d.interet_empower);

    return filled;
  }

  // ── BLOC 10 : Marketing ──
  document.getElementById('toggle-marketing')?.addEventListener('change', function() {
    document.getElementById('marketing-non-wrap').classList.toggle('hidden', this.checked);
    document.getElementById('marketing-oui-wrap').classList.toggle('hidden', !this.checked);
    if (this.checked) initPhotosMarketing();
  });

  function initPhotosMarketing() {
    const grid = document.getElementById('marketing-photos-grid');
    if (!grid || grid.children.length > 0) return;
    const TAGS = ['PLV en place','Affiche vitrine','MEA','Leaflets / Flyers','Box / Totem','Présentoir comptoir','Rayon produit','Entrée magasin','Autre'];
    for (let i = 1; i <= 4; i++) {
      const slot = document.createElement('div');
      slot.className = 'photo-slot';
      slot.id = `photo-slot-${i}`;
      slot.innerHTML = `<span>📷 Photo ${i}</span>`;
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
      inp.className = 'hidden';
      inp.addEventListener('change', function() {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
          slot.innerHTML = `<img src="${e.target.result}" alt="Photo ${i}" />`;
          const sel = document.createElement('select');
          sel.innerHTML = `<option value="">Tag…</option>` + TAGS.map(t => `<option value="${t}">${t}</option>`).join('');
          slot.appendChild(sel);
          data[`marketing_photo_${i}`] = e.target.result;
          sel.addEventListener('change', () => { data[`marketing_tag_${i}`] = sel.value; });
        };
        reader.readAsDataURL(file);
      });
      slot.addEventListener('click', () => inp.click());
      slot.appendChild(inp);
      grid.appendChild(slot);
    }
  }

  document.getElementById('toggle-action-mktg')?.addEventListener('change', function() {
    document.getElementById('action-mktg-wrap').classList.toggle('hidden', !this.checked);
  });

  // ── Chips multi-select globaux ──
  document.querySelectorAll('.chip--coral-select').forEach(btn => {
    btn.addEventListener('click', function() {
      const group = this.closest('.chips-group');
      if (group?.classList.contains('chips-group--exclusive')) {
        group.querySelectorAll('.chip--coral-select').forEach(c => c.classList.remove('selected'));
      }
      this.classList.toggle('selected');
    });
  });

  // ── Validation bloc ──
  function validateBloc(n) {
    if (n === 1) {
      const src = document.getElementById('v-source')?.value;
      if (!src) { UI.toast('Choisissez une source de visite', 'warning'); return false; }
      if (src === 'cold_revendeur') {
        if (!document.getElementById('v-nom-enseigne')?.value.trim()) {
          UI.toast('Renseignez le nom de l\'enseigne', 'warning'); return false;
        }
        if (!document.getElementById('v-ville')?.value.trim()) {
          UI.toast('Renseignez la ville', 'warning'); return false;
        }
        // Anti-doublon 95% bloquant
        // (contrôle Jaccard simplifié déjà dans typeahead)
      }
    }
    return true;
  }

  // ── Collecte données par bloc ──
  function collectBloc(n) {
    if (n === 1) {
      data.source       = document.getElementById('v-source')?.value;
      data.date_visite  = document.getElementById('v-date')?.value;
      data.heure_visite = document.getElementById('v-heure')?.value;
      data.type_visite  = document.getElementById('v-type')?.value;
      if (data.source === 'cold_revendeur') {
        data.nom_enseigne = document.getElementById('v-nom-enseigne')?.value;
        data.ville        = document.getElementById('v-ville')?.value;
        data.segment      = document.getElementById('v-segment')?.value;
        // Règle métier : cold revendeur → Origine=Visite_terrain
        data.origine      = 'Visite_terrain';
      }
    }
    if (n === 2) {
      data.profil_revendeur = collectChipsGroup('chips-type-revendeur');
      data.clientele        = collectChipsGroup('chips-clientele');
      data.canal            = collectChipsGroup('chips-canal');
    }
    if (n === 3) data.objectifs = collectChipsGroup('chips-objectifs');
    if (n === 4) {
      data.checklist_norton  = collectChecklist('checklist-norton');
      data.empower_interet   = collectChipsGroup('chips-empower-interet', true);
      data.empower_raison    = collectChipsGroup('chips-empower-raison', true);
      data.portails_actifs   = document.getElementById('v-portails')?.value;
    }
    if (n === 5) {
      data.freins             = collectChipsGroup('chips-freins');
      data.contre_argument    = document.getElementById('v-contre-argument')?.value;
      data.frein_resultat     = collectChipsGroup('chips-frein-resultat', true);
    }
    if (n === 6) {
      data.concurrents        = collectChipsGroup('chips-concurrents');
      data.position_norton    = document.getElementById('v-position-norton')?.value;
      data.part_lineaire      = document.getElementById('v-part-lineaire')?.value;
    }
    if (n === 7) {
      data.grossistes         = collectChipsGroup('chips-grossistes');
      data.canal_appro        = collectChipsGroup('chips-canal-appro', true);
    }
    if (n === 8) {
      data.resultat           = collectChipsGroup('chips-resultat', true);
      data.receptivite        = document.getElementById('v-receptivite')?.value;
      data.interlocuteur      = {
        prenom:    document.getElementById('v-interlocuteur-prenom')?.value,
        nom:       document.getElementById('v-interlocuteur-nom')?.value,
        fonction:  document.getElementById('v-interlocuteur-fonction')?.value,
        tel:       document.getElementById('v-tel')?.value,
        email:     document.getElementById('v-email')?.value,
      };
      data.prochaine_action   = document.getElementById('v-prochaine-action')?.value;
      data.prochaine_date     = document.getElementById('v-prochaine-date')?.value;
      data.statut_empower     = document.getElementById('v-statut-empower')?.value;
      // Règle auto réceptivité ≥ 4 → CHAUD
      if (parseInt(data.receptivite) >= 4) data.label_ia = 'CHAUD';
    }
    if (n === 9) {
      data.note_privee = document.getElementById('v-note-privee')?.value;
    }
    if (n === 10) {
      data.marketing_present = document.getElementById('toggle-marketing')?.checked;
      if (data.marketing_present) {
        data.marketing_supports  = collectChipsGroup('chips-supports');
        data.marketing_etat      = collectChipsGroup('chips-etat-mktg', true);
        data.marketing_action_req = document.getElementById('toggle-action-mktg')?.checked;
        data.marketing_action_type= document.getElementById('v-action-mktg-type')?.value;
        data.marketing_action_note= document.getElementById('v-action-mktg-note')?.value;
      } else {
        data.marketing_raison_absence = collectChipsGroup('chips-raison-absence', true);
      }
      data.cds_pin  = STATE.pin;
      data.cds_nom  = STATE.user?.prenom;
    }
  }

  function collectChipsGroup(id, exclusive = false) {
    const chips = document.querySelectorAll(`#${id} .selected`);
    const vals  = [...chips].map(c => c.dataset.val);
    return exclusive ? (vals[0] || '') : vals;
  }

  function collectChecklist(id) {
    const boxes = document.querySelectorAll(`#${id} input[type="checkbox"]:checked`);
    return [...boxes].map(b => b.value);
  }

  // ── SOUMETTRE ──
  document.getElementById('btn-submit-visite')?.addEventListener('click', async () => {
    collectBloc(10);
    // ── PATCH CRITIQUE : injecter le PIN avant envoi ──
    // Sans cette ligne, addVisite reçoit cds_pin=null → écriture Sheet cassée
    data.cds_pin = STATE.pin;
    try {
      document.getElementById('btn-submit-visite').disabled = true;
      document.getElementById('btn-submit-visite').textContent = '⏳ Enregistrement…';
      const result = await API.addVisite(data);
      if (result.success) {
        STATE.visiteDraft = null;
        UI.toast('✅ Visite enregistrée avec succès', 'success');
        Router.navigate('/pipeline');
      }
    } catch (e) {
      UI.toast('Erreur : ' + e.message, 'danger');
      document.getElementById('btn-submit-visite').disabled = false;
      document.getElementById('btn-submit-visite').textContent = '✅ Enregistrer la visite';
    }
  });

  showBloc(1);
};

/* ── 9.6 PHONING ── */
Screens.phoning = async function() {
  // Compteur
  try {
    const p = await API.getCompteurPhoning();
    document.getElementById('phoning-week-count').textContent = p.nb_appels;
    document.getElementById('phoning-week-label').textContent = `Semaine ${p.semaine}`;
    // Cercle SVG
    const circle = document.getElementById('counter-circle');
    const circumference = 163;
    const offset = circumference - (p.nb_appels / p.objectif) * circumference;
    circle.style.strokeDashoffset = Math.max(0, offset);
  } catch { /* silence */ }

  // Liste comptes à appeler (priorité Rouge + statut pertinent)
  try {
    const comptes = await API.getComptes();
    const aAppeler = comptes.filter(c => ['A_contacter','En_discussion'].includes(c.statut));
    const list = document.getElementById('call-list');
    list.innerHTML = '';
    if (aAppeler.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>Aucun compte en liste d\'appels</p></div>';
    } else {
      aAppeler.forEach(c => {
        const div = document.createElement('div');
        div.className = 'call-item';
        div.innerHTML = `
          <div>
            <p class="call-item__nom">${Utils.esc(c.nom)}</p>
            <p class="call-item__meta">${c.ville} — ${c.segment}</p>
          </div>
          <button class="btn btn--coral btn--sm">📞 Appeler</button>`;
        div.querySelector('button').addEventListener('click', () => ouvrirQuestionnaire(c));
        list.appendChild(div);
      });
    }
  } catch { /* silence */ }

  function ouvrirQuestionnaire(compte) {
    const panel = document.getElementById('phoning-questionnaire');
    document.getElementById('appel-compte-nom').textContent = compte.nom;
    panel.classList.remove('hidden');

    const QUESTIONS = [
      'Avez-vous pu joindre l\'interlocuteur ?',
      'Intérêt pour Norton 360 ?',
      'Intérêt pour EMPOWER ?',
      'Besoin de démo ?',
      'Commande potentielle ?',
      'Date de rappel souhaitée ?',
      'Freins identifiés ?',
      'Concurrents mentionnés ?',
      'Prochaine action convenue ?',
      'Notes complémentaires',
    ];

    const container = document.getElementById('questionnaire-questions');
    container.innerHTML = '';
    QUESTIONS.forEach((q, i) => {
      const div = document.createElement('div');
      div.className = 'question-item';
      div.innerHTML = `<label class="form-label">${i + 1}. ${Utils.esc(q)}</label>
        <input type="text" class="text-input" id="q-${i}" placeholder="Réponse…" />`;
      container.appendChild(div);
    });

    document.getElementById('btn-close-questionnaire').onclick = () => panel.classList.add('hidden');

    document.getElementById('btn-save-appel').onclick = async () => {
      const responses = QUESTIONS.reduce((acc, q, i) => {
        acc[`q${i + 1}`] = document.getElementById(`q-${i}`)?.value || '';
        return acc;
      }, {});
      await API.addAppel({ compte_id: compte.id, compte_nom: compte.nom, responses, date: Utils.dateToday() });
      panel.classList.add('hidden');
      UI.toast('✅ Appel enregistré', 'success');
      Screens.phoning(); // refresh compteur
    };
  }

  document.getElementById('btn-add-appel')?.addEventListener('click', () => {
    Router.navigate('/pipeline');
  });
};

/* ── 9.7 COPIL ── */
Screens.copil = async function() {
  document.getElementById('copil-quarter-label').textContent = `${CONFIG.QUARTER_ACTIF} ${CONFIG.FY}`;

  // Team KPI
  const teamList = document.getElementById('team-kpi-list');
  teamList.innerHTML = '';
  const cdsPins = [4001, 4002, 4003];
  for (const pin of cdsPins) {
    const user = USERS[pin];
    const obj  = OBJECTIFS_FY27[pin];
    const q    = CONFIG.QUARTER_ACTIF;
    const initial = obj[q];
    // Fallback Q_Obj_Révisé vide → Q_Obj_Initial
    const revise = STATE.objectifsRevises[pin + '_' + q] || null;
    const objCalc = (revise && revise > 0) ? revise : initial;
    // Simule atteinte variable
    const reelSimule = Math.round(objCalc * [0.84, 1.02, 0.76][cdsPins.indexOf(pin)]);
    const pct = Math.round((reelSimule / objCalc) * 100);

    const card = document.createElement('div');
    card.className = 'team-kpi-card';
    const pctClass = pct >= 100 ? 'good' : pct >= 80 ? 'warning' : 'danger';
    card.innerHTML = `
      <div class="team-kpi-card__header">
        <span class="team-kpi-card__nom">${user.prenom}</span>
        <span class="team-kpi-card__pct team-kpi-card__pct--${pctClass}">${pct}%</span>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-bar">
          <div class="progress-bar__fill ${Utils.fillClass(pct)}" style="width:${Math.min(pct,100)}%"></div>
        </div>
        <div class="progress-bar-labels">
          <span>${Utils.formatEur(reelSimule)}</span>
          <span>Obj: ${Utils.formatEur(objCalc)}</span>
        </div>
      </div>`;
    teamList.appendChild(card);
  }

  // Bonus manager : inséré dans DOM uniquement PIN 1000
  if (Auth.isPin1000()) {
    const bonus = document.createElement('div');
    bonus.className = 'bonus-manager-card';
    // Calcul collectif : CDS Obj=0 exclus
    const totReel = 120; // simulé %
    const montant = totReel >= 100 ? 300 : 0;
    bonus.innerHTML = `
      <div class="bonus-manager-card__title">🏆 Bonus Manager — Collectif Q${CONFIG.QUARTER_ACTIF}</div>
      <div class="bonus-manager-card__val">${montant}€</div>
      <p class="text-muted" style="font-size:.75rem">Atteinte collective : ${totReel}% — Seuil : 100%</p>`;
    teamList.insertAdjacentElement('afterend', bonus);
  }

  // Objectifs table
  try {
    const objRows = await API.getObjectifs();
    const table = document.getElementById('objectifs-table');
    table.innerHTML = `
      <div class="obj-row obj-row--header">
        <span>CDS</span><span class="obj-val">Q1</span><span class="obj-val">Q2</span><span class="obj-val">Q3</span><span class="obj-val">Q4</span>
      </div>`;
    objRows.forEach(row => {
      const div = document.createElement('div');
      div.className = 'obj-row';
      // Affiche révisé si non vide, sinon initial
      const q = CONFIG.QUARTER_ACTIF;
      const displayQ = (initial, revised) => revised > 0 ? `<strong>${Utils.formatEur(revised)}</strong>` : Utils.formatEur(initial);
      div.innerHTML = `
        <span>${row.nom}</span>
        <span class="obj-val">${displayQ(row.Q1, row.Q1_rev)}</span>
        <span class="obj-val">${displayQ(row.Q2, row.Q2_rev)}</span>
        <span class="obj-val">${displayQ(row.Q3, row.Q3_rev)}</span>
        <span class="obj-val">${displayQ(row.Q4, row.Q4_rev)}</span>`;
      table.appendChild(div);
    });
  } catch { /* silence */ }

  // Réviser objectif (PIN 1000 = validation immédiate / PIN 2000 = co-validation)
  document.getElementById('btn-reviser-obj')?.addEventListener('click', () => {
    // Note co-validation visible seulement pour Alexandra
    const noteCoVal = Auth.isAlexandra()
      ? `<p class="text-muted" style="font-size:.75rem;margin-top:.5rem">⚠️ Révision en co-validation — nécessite confirmation du manager (PIN 1000)</p>`
      : '';
    const html = `
      <div class="form-group">
        <label class="form-label">CDS</label>
        <select class="select-input" id="rev-cds">
          <option value="4001">Mehdi</option>
          <option value="4002">Lyes</option>
          <option value="4003">Johanne</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Quarter</label>
        <select class="select-input" id="rev-quarter">
          <option>Q1</option><option>Q2</option><option>Q3</option><option>Q4</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Nouvel objectif (€)</label>
        <input type="number" class="text-input" id="rev-val" placeholder="ex: 5200" min="1" />
      </div>${noteCoVal}`;
    UI.openModal('Réviser un objectif', html, async () => {
      const cdsPin = parseInt(document.getElementById('rev-cds').value);
      const quarter = document.getElementById('rev-quarter').value;
      const val = parseInt(document.getElementById('rev-val').value);
      if (!val || val <= 0) { UI.toast('Valeur invalide', 'danger'); return; }
      const result = await API.updateObjectif(cdsPin, quarter, val);
      STATE.objectifsRevises[cdsPin + '_' + quarter] = val;
      const msg = result?.co_validation
        ? '📋 Révision soumise — en attente de validation manager'
        : '✅ Objectif révisé';
      UI.toast(msg, 'success');
      Screens.copil();
    });
  });

  // Exports
  document.getElementById('btn-export-pdf')?.addEventListener('click', () => API.exportPDF());
  document.getElementById('btn-export-excel')?.addEventListener('click', () => API.exportExcel());

  // Import CA (PIN 1000 + 2000)
  const btnImportCA = document.getElementById('btn-import-ca');
  if (btnImportCA) {
    if (!Auth.isManager()) { btnImportCA.classList.add('hidden'); }
    else {
      btnImportCA.addEventListener('click', () => {
        const html = `
          <div class="form-group">
            <label class="form-label">ID Compte</label>
            <input type="text" class="text-input" id="ica-compte" placeholder="ex: C001" />
          </div>
          <div class="form-group">
            <label class="form-label">Montant CA importé (€)</label>
            <input type="number" class="text-input" id="ica-montant" min="1" placeholder="ex: 1200" />
          </div>
          <div class="form-group">
            <label class="form-label">Quarter</label>
            <select class="select-input" id="ica-quarter">
              <option>Q1</option><option>Q2</option><option>Q3</option><option>Q4</option>
            </select>
          </div>`;
        UI.openModal('Import CA', html, async () => {
          const compteId = document.getElementById('ica-compte').value.trim();
          const montant  = parseFloat(document.getElementById('ica-montant').value);
          const quarter  = document.getElementById('ica-quarter').value;
          if (!compteId || montant <= 0) { UI.toast('Données invalides', 'danger'); return; }
          await API.importCA(compteId, montant, quarter);
          UI.toast('✅ CA importé', 'success');
          Screens.copil();
        });
      });
    }
  }

  // Lien vers Dashboard Leads Flavie (PIN 2000 + 3000)
  const btnLeads = document.getElementById('btn-voir-leads');
  if (btnLeads) {
    if (!Auth.hasDroit('leads_flavie')) { btnLeads.classList.add('hidden'); }
    else { btnLeads.addEventListener('click', () => Router.navigate('/flavie')); }
  }

  // NSB
  try {
    const nsbs = await API.getNSBCommandes();
    const nsbList = document.getElementById('nsb-list');
    nsbList.innerHTML = nsbs.length === 0
      ? '<div class="empty-state"><p>Aucune commande NSB en attente</p></div>'
      : nsbs.map(n => `<div class="call-item"><div><p class="call-item__nom">${Utils.esc(n.nom)}</p><p class="call-item__meta">${n.date}</p></div><button class="btn btn--coral btn--sm" data-nsb-id="${n.id}">Valider</button></div>`).join('');

    nsbList.querySelectorAll('[data-nsb-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await API.validerNSB(btn.dataset.nsbId);
        UI.toast('NSB validé', 'success');
        Screens.copil();
      });
    });
  } catch { /* silence */ }

  // Comptes bloqués
  try {
    const all = await API.getComptes();
    const bloques = all.filter(c => c.statut === 'Bloqué');
    const bList = document.getElementById('blocked-list');
    bList.innerHTML = bloques.length === 0
      ? '<div class="empty-state"><p>Aucun compte bloqué</p></div>'
      : bloques.map(c => `<div class="call-item"><div><p class="call-item__nom">${Utils.esc(c.nom)}</p><p class="call-item__meta">${c.ville} — ${CDS_LABELS[c.cds]}</p></div></div>`).join('');
  } catch { /* silence */ }
};

/* ── 9.8 FLAVIE ── */
Screens.flavie = async function() {
  // Alertes EMPOWER intéressé
  try {
    const prospects = await API.getProspects();
    const alertes = prospects.filter(p => p.empower_interet === 'OUI_interesse' || p.flag_alerte_flavie);
    document.getElementById('alertes-count').textContent = alertes.length;

    const list = document.getElementById('alertes-list');
    list.innerHTML = alertes.length === 0
      ? '<div class="empty-state"><p>Aucune alerte EMPOWER</p></div>'
      : '';
    alertes.forEach(p => {
      const div = document.createElement('div');
      div.className = 'alerte-item';
      div.innerHTML = `<p class="alerte-item__nom">${Utils.esc(p.nom)}</p>
        <p class="alerte-item__meta">${p.ville} — CDS : ${CDS_LABELS[p.assigné_à] || '—'}</p>
        <span class="chip chip--small">${p.statut.replace(/_/g,' ')}</span>`;
      list.appendChild(div);
    });
  } catch { /* silence */ }

  // Pipeline visite terrain (lecture seule)
  try {
    const comptes = await API.getComptes(null); // tous
    const pipeline = document.getElementById('flavie-pipeline');
    pipeline.innerHTML = '';
    const terrain = comptes.filter(c => c.origine === 'Visite_terrain');
    terrain.forEach(c => {
      const div = document.createElement('div');
      div.className = 'alerte-item';
      div.innerHTML = `<p class="alerte-item__nom">${Utils.esc(c.nom)}</p>
        <p class="alerte-item__meta">${c.ville} — ${c.segment} — Score ${c.score}</p>
        <span class="chip-statut chip-statut--${c.statut}">${c.statut.replace(/_/g,' ')}</span>`;
      pipeline.appendChild(div);
    });
    if (terrain.length === 0) pipeline.innerHTML = '<div class="empty-state"><p>Aucune visite terrain</p></div>';
  } catch { /* silence */ }

  // Ajout lead manuel → Origine=Flavie
  document.getElementById('btn-ajouter-lead')?.addEventListener('click', () => {
    const html = `
      <div class="form-group">
        <label class="form-label">Nom enseigne *</label>
        <input type="text" class="text-input" id="lead-nom" placeholder="ex: InfoTech SARL" />
      </div>
      <div class="form-group">
        <label class="form-label">Ville</label>
        <input type="text" class="text-input" id="lead-ville" placeholder="ex: Lyon" />
      </div>
      <div class="form-group">
        <label class="form-label">Segment</label>
        <select class="select-input" id="lead-segment">
          <option value="IT">IT</option>
          <option value="MSP">MSP</option>
          <option value="Boutique">Boutique</option>
          <option value="Autre">Autre</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Assigner à</label>
        <select class="select-input" id="lead-cds">
          <option value="4001">Mehdi</option>
          <option value="4002">Lyes</option>
          <option value="4003">Johanne</option>
        </select>
      </div>`;
    UI.openModal('Ajouter un lead', html, async () => {
      const nom = document.getElementById('lead-nom')?.value;
      if (!nom?.trim()) { UI.toast('Nom obligatoire', 'warning'); return; }
      await API.createProspect({
        nom, ville: document.getElementById('lead-ville').value,
        segment: document.getElementById('lead-segment').value,
        assigné_à: parseInt(document.getElementById('lead-cds').value),
        origine: 'Flavie', // Règle métier
      });
      UI.toast('✅ Lead ajouté — Origine : Flavie', 'success');
      Screens.flavie();
    });
  });
};

/* ── 9.9 PRIMES ── */
Screens.primes = async function() {
  async function loadPrimes(quarter) {
    try {
      const p = await API.getPrimes(quarter);

      // AXE 1
      document.getElementById('prime1-amount').textContent = p.axe1 + '€';
      document.getElementById('prime1-pct').textContent = p.kpi_pct + '%';
      document.getElementById('prime1-obj').textContent = Utils.formatEur(p.kpi_obj);
      const fill1 = document.getElementById('prime1-fill');
      fill1.style.width = `${Math.min(p.kpi_pct, 100)}%`;
      fill1.className = `progress-bar__fill ${Utils.fillClass(p.kpi_pct)}`;

      // Grille AXE1 — highlight actif
      document.querySelectorAll('.prime-grid-item').forEach(item => item.style.fontWeight = '');
      if (p.kpi_pct >= 120)       document.querySelector('.prime-grid-item--best')?.querySelectorAll('strong')[0]?.style.setProperty('text-decoration','underline');
      else if (p.kpi_pct >= 100)  { /* 3e item */ }

      // AXE 2
      document.getElementById('prime2-amount').textContent = p.axe2 + '€';
      document.getElementById('nsb-count-val').textContent = p.nsb;
      // Grille AXE2 selon profil
      const grid2 = document.getElementById('axe2-grid');
      const isTadLyes = [1000, 4002].includes(STATE.pin);
      grid2.innerHTML = isTadLyes
        ? `<div class="prime-grid-item"><span>< 8</span><strong>0€</strong></div>
           <div class="prime-grid-item"><span>≥ 8</span><strong>200€</strong></div>
           <div class="prime-grid-item prime-grid-item--best"><span>≥ 12</span><strong>400€</strong></div>`
        : `<div class="prime-grid-item"><span>< 5</span><strong>0€</strong></div>
           <div class="prime-grid-item"><span>≥ 5</span><strong>200€</strong></div>
           <div class="prime-grid-item prime-grid-item--best"><span>≥ 8</span><strong>400€</strong></div>`;

      // AXE 3
      document.getElementById('prime3-amount').textContent = (p.axe3a + p.axe3b) + '€';
      document.getElementById('axe3a-val').textContent = p.axe3a + '€';
      document.getElementById('axe3b-val').textContent = p.axe3b + '€';

      // Total
      document.getElementById('prime-total').textContent = p.total + '€';
    } catch {
      UI.toast('Impossible de charger les primes', 'danger');
    }
  }

  document.getElementById('primes-quarter-select')?.addEventListener('change', e => loadPrimes(e.target.value));
  await loadPrimes(CONFIG.QUARTER_ACTIF);
};

/* ── 9.10 PLANNING ── */
Screens.planning = async function() {
  let weekOffset = 0;

  function getWeekDates(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1 + offset * 7);
    const days = [];
    for (let i = 0; i < 5; i++) {
      const day = new Date(d);
      day.setDate(d.getDate() + i);
      days.push(day);
    }
    return days;
  }

  function renderWeek(offset) {
    const days = getWeekDates(offset);
    const today = Utils.dateToday();
    const semaine = Utils.semaineISO() + offset;
    document.getElementById('planning-week-label').textContent = `Semaine ${semaine}`;

    const grid = document.getElementById('planning-grid');
    grid.innerHTML = '';
    const JOURS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi'];

    days.forEach((d, i) => {
      const dateStr = d.toISOString().split('T')[0];
      const isToday = dateStr === today;
      const visitesJour = STATE.actions.filter(a => a.date === dateStr);

      const div = document.createElement('div');
      div.className = 'planning-day';
      div.innerHTML = `<div class="planning-day__header${isToday ? ' planning-day__header--today' : ''}">
        ${JOURS[i]} ${d.getDate()}/${d.getMonth() + 1}
      </div>
      <div class="planning-day__items" id="day-${dateStr}"></div>`;
      grid.appendChild(div);

      const items = div.querySelector(`#day-${dateStr}`);
      if (visitesJour.length === 0) {
        const empty = document.createElement('p');
        empty.style.cssText = 'font-size:.75rem;color:var(--text-secondary);padding:6px 0;';
        empty.textContent = 'Aucune visite';
        items.appendChild(empty);
      } else {
        visitesJour.forEach(v => {
          const item = document.createElement('div');
          item.className = `planning-item planning-item--${v.statut_planning || 'planifie'}`;
          item.textContent = `${v.heure || '—'} — ${v.compte_nom}`;
          items.appendChild(item);
        });
      }
    });
  }

  document.getElementById('btn-week-prev')?.addEventListener('click', () => { weekOffset--; renderWeek(weekOffset); });
  document.getElementById('btn-week-next')?.addEventListener('click', () => { weekOffset++; renderWeek(weekOffset); });

  renderWeek(0);
};

/* ── 9.11 TUTORIEL ── */
Screens.tuto = function() {
  const isManager = Auth.isManager();

  const SLIDES_CDS = [
    { id:'CDS_01', emoji:'👋', title:'Bienvenue sur EMPOWER ROOM INTELLIGENCE', body:'Votre outil terrain pour piloter la croissance Norton. Simple, rapide, efficace.', tip:'Utilisez votre PIN 6 chiffres pour vous connecter.' },
    { id:'CDS_02', emoji:'📊', title:'Dashboard', body:'Suivez votre CA en temps réel, vos primes AXE1/2/3 et vos stats d\'activité hebdomadaires.', tip:'Le KPI Q1 se met à jour à chaque synchronisation.' },
    { id:'CDS_03', emoji:'🏪', title:'Ajouter un prospect', body:'3 sources possibles : Base historique, Prospect existant ou Cold revendeur. Chaque visite à froid crée automatiquement un prospect.', tip:'L\'anti-doublon alerte à 80%, bloque à 95%.' },
    { id:'CDS_04', emoji:'🔄', title:'Convertir un prospect', body:'Vous pouvez convertir un prospect en compte actif sans passer par Flavie. Saisie directe depuis la fiche prospect.', tip:'Origine = CDS_autonome pour votre AXE3B.' },
    { id:'CDS_05', emoji:'💰', title:'CA Terrain', body:'Renseignez le CA après chaque visite. Il s\'ajoute au CA import pour le total de votre KPI.', tip:'Pas d\'invention de prix — uniquement les montants réels.' },
    { id:'CDS_06', emoji:'🏆', title:'Mes Primes', body:'AXE1 CA, AXE2 NSB, AXE3 Activation + Onboarding. Suivez votre progression en temps réel dans l\'onglet Primes.', tip:'NSB comptabilisé uniquement si Flag_Comptabilisé=TRUE.' },
  ];

  const SLIDES_MGR = [
    { id:'MGR_01', emoji:'👀', title:'Vue Manager', body:'Accédez au tableau de bord collectif avec les KPI de chaque CDS : Mehdi, Lyes, Johanne.', tip:'Filtrez par CDS dans le Pipeline pour accéder à leurs comptes.' },
    { id:'MGR_02', emoji:'📋', title:'COPIL', body:'Générez le rapport COPIL PDF 4 pages et l\'export Excel EMPOWER pour les revues avec Norton/Gen Digital.', tip:'Accessible uniquement PIN 1000 et 2000.' },
    { id:'MGR_03', emoji:'✏️', title:'Modifier un objectif', body:'Révisez Q_Obj d\'un CDS pour un quarter donné. La révision à 0 est bloquée.', tip:'FALLBACK : Q_Obj_Révisé vide → Q_Obj_Initial automatiquement.' },
    { id:'MGR_04', emoji:'📥', title:'Import CA', body:'Importez le CA from Salesforce ou fichier Excel. Le CA terrain + import = CA TOTAL.', tip:'Import visible sur la fiche compte.' },
    { id:'MGR_05', emoji:'🏅', title:'Bonus Manager', body:'Si l\'équipe atteint ≥ 100% collectivement, vous percevez 300€/Q. CDS Obj=0 exclus du calcul.', tip:'Affiché dans le COPIL uniquement pour PIN 1000.' },
    { id:'MGR_06', emoji:'🚫', title:'Comptes bloqués', body:'Visualisez et gérez les comptes bloqués depuis le COPIL. Dé-bloquez via modification de statut.', tip:'' },
    { id:'MGR_07', emoji:'⭐', title:'Valider NSB', body:'Les commandes NSB doivent être validées (Flag_Comptabilisé=TRUE) pour être comptabilisées en prime.', tip:'Validation depuis COPIL → section NSB.' },
    { id:'MGR_08', emoji:'✅', title:'C\'est parti !', body:'Vous maîtrisez EMPOWER ROOM INTELLIGENCE V4.1. Bonne saison FY27 !', tip:'En cas de problème : T.soefou@agence-impact.com' },
  ];

  const slides = isManager ? [...SLIDES_CDS, ...SLIDES_MGR] : SLIDES_CDS;
  let current = 0;

  // Dots
  const dots = document.getElementById('tuto-dots');
  const slidesContainer = document.getElementById('tuto-slides');
  dots.innerHTML = '';
  slidesContainer.innerHTML = '';

  slides.forEach((s, i) => {
    // Dot
    const dot = document.createElement('div');
    dot.className = `tuto-dot${i === 0 ? ' active' : ''}`;
    dots.appendChild(dot);

    // Slide
    const div = document.createElement('div');
    div.className = `tuto-slide${i === 0 ? ' active' : ''}`;
    div.innerHTML = `
      <div class="tuto-slide__emoji">${s.emoji}</div>
      <h2 class="tuto-slide__title">${Utils.esc(s.title)}</h2>
      <p class="tuto-slide__body">${Utils.esc(s.body)}</p>
      ${s.tip ? `<div class="tuto-slide__tip">💡 ${Utils.esc(s.tip)}</div>` : ''}`;
    slidesContainer.appendChild(div);
  });

  function showSlide(n) {
    document.querySelectorAll('.tuto-slide').forEach((s, i) => s.classList.toggle('active', i === n));
    document.querySelectorAll('.tuto-dot').forEach((d, i) => d.classList.toggle('active', i === n));
    document.getElementById('btn-tuto-prev').disabled = n === 0;
    const isLast = n === slides.length - 1;
    document.getElementById('btn-tuto-next').textContent = isLast ? '✅ Terminer' : 'Suivant →';
  }

  document.getElementById('btn-tuto-next')?.addEventListener('click', () => {
    if (current < slides.length - 1) {
      current++; showSlide(current);
    } else {
      Auth.marquerTutoDone();
      Router.navigate('/home');
    }
  });
  document.getElementById('btn-tuto-prev')?.addEventListener('click', () => {
    if (current > 0) { current--; showSlide(current); }
  });
  document.getElementById('btn-skip-tuto')?.addEventListener('click', () => {
    Auth.marquerTutoDone();
    Router.navigate('/home');
  });

  showSlide(0);
};

/* ── 9.12 PROFIL ── */
Screens.profil = function() {
  const u = STATE.user;
  const nom = u?.prenom || '—';
  document.getElementById('profil-nom').textContent = nom;
  document.getElementById('profil-avatar-letter').textContent = nom[0]?.toUpperCase() || '?';
  document.getElementById('profil-role').textContent = u?.role || '—';
  document.getElementById('profil-role-info').textContent = u?.role || '—';
  document.getElementById('profil-last-login').textContent = new Date(STATE.loginTime || Date.now()).toLocaleString('fr-FR');
  document.getElementById('profil-session-exp').textContent = Auth.getSessionRestante() + ' min';
  document.getElementById('profil-quarter').textContent = `${CONFIG.QUARTER_ACTIF} ${CONFIG.FY}`;

  document.getElementById('btn-voir-tuto')?.addEventListener('click', () => Router.navigate('/tuto'));
  document.getElementById('btn-phoning-profil')?.addEventListener('click', () => Router.navigate('/phoning'));
  document.getElementById('btn-deconnexion')?.addEventListener('click', () => {
    UI.openModal('Déconnexion', '<p>Confirmer la déconnexion ?</p>', () => Auth.logout());
  });
};

/* ════════════════════════════════════════════
   10. INIT — Démarrage de l'application
════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Cacher loader initial après chargement
  setTimeout(() => {
    document.getElementById('global-loader').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');

    // Initialiser auth + router
    Router.init();

    const loggedIn = Auth.init();
    if (loggedIn) {
      // Badge Marvesting visible pour tous les utilisateurs connectés
      document.getElementById('badge-marvesting').classList.remove('hidden');
      // Redirection selon rôle
      const currentPath = window.location.pathname.replace(/.*empower-v4/, '') || '/login';
      if (currentPath === '/login' || currentPath === '/') {
        if (Auth.isPin1000() || STATE.pin === 2000) Router.navigate('/copil');
        else if (Auth.isFlavie()) Router.navigate('/flavie');
        else if (Auth.isCDS() && !Auth.tutoFait()) Router.navigate('/tuto');
        else Router.navigate('/home');
      } else {
        Router.navigate(currentPath);
      }
    } else {
      Router.navigate('/login');
    }
  }, 600);

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .then(() => console.log('[SW] Enregistré'))
      .catch(e => console.warn('[SW] Erreur:', e));
  }
});
