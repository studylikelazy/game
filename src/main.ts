import { weaponArt } from './weaponArt';
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-serif-jp/400.css';
import './style.css';
import './fantasy-ui.css';
import { healingFlask, resourceOrbs, resourcePercent } from './hud';
import { addPlayer, bagValue, bagWeight, distance, EXITS, idleInput, ITEMS, makeGame, meleeGear, bowGear, stepGame, STARTER_GEAR, starterMelee, equipInField, weaponDps, weaponKind, type GameState, type Player } from './game';
import { RARITIES, SLOTS, SLOT_LABELS, baseOf, encodeLoadout, entryValue, globalStats, isGear, weaponProfile, type BagEntry, type Gear, type Material, type Slot } from './items';
import { entryCard, entryLabel, gearCard, gearTooltip, materialCard } from './itemcard';
import { characterSheetHtml, gearSummary, slotGrid, SLOT_ICONS } from './gearui';
import { icon, raven } from './icons';
import { audio } from './audio';
import { attackStarted, type AttackSnapshot } from './combatAudio';
import { FIRES, Renderer } from './renderer';
import { loadSave, storeSave } from './save';

const app = document.querySelector<HTMLDivElement>('#app')!;
/** Canvas drawing is paced to 60fps; input and simulation still run on every display refresh. */
const TARGET_FRAME_MS = 1000 / 60;
const save = loadSave();
document.body.classList.toggle('reduced-motion', save.reducedMotion);
const staticHost = import.meta.env.MODE === 'pages';
let game: GameState = makeGame(), playerId = 'local', playing = false, paused = false, mapOpen = false, mode: 'solo' | 'online' = 'solo';
let socket: WebSocket | null = null, connecting = false, resultShown = false, sendAt = 0, hudAt = 0, gameStartedAt = 0, currentModal = '', bagOpen = false;
/** The loadout worn when the raid started, so a failed raid can restore it. */
let raidStartLoadout: Partial<Record<Slot, Gear>> = {};
let onlineAvailable = false;
const keys = new Set<string>();
const input = idleInput();
let aimPointer: number | null = null, mouseAttack = false;
let cursorWorld: { x: number; y: number } | null = null;
const coarsePointer = () => matchMedia('(pointer: coarse)').matches;
const fmt = (n: number) => n.toLocaleString('ja-JP');
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const contracts = [
  { id: 'first', title: '帰るまでが、遠征だ', desc: '戦場から生きて脱出する', icon: 'exit', goal: 1, value: () => save.escapes, reward: 300 },
  { id: 'gather', title: '灰の中の拾い物', desc: '物資を5点持ち帰る', icon: 'stash', goal: 5, value: () => save.collected, reward: 450 },
  { id: 'hunt', title: '小道の掃除人', desc: '敵を5体倒して帰還する', icon: 'sword', goal: 5, value: () => save.kills, reward: 600 },
];
const portrait = `<img class="character-art" src="${import.meta.env.BASE_URL}assets/ui/wanderer-portrait.webp" alt="鋼と真鍮の鎧をまとった辺境の旅人" decoding="async" />`;

app.innerHTML = `
  <aside class="rail">
    <a class="brand-mark" href="#" aria-label="ASHENFELL ホーム">${raven}</a>
    <div class="rail-rule"></div>
    <nav aria-label="メインメニュー">
      <button class="nav-item active" data-nav="raid">${icon('compass')}<span>遠征</span></button>
      <button class="nav-item" data-nav="stash">${icon('stash')}<span>倉庫</span></button>
      <button class="nav-item" data-nav="quests">${icon('scroll')}<span>依頼</span><i class="notification-dot"></i></button>
      <button class="nav-item" data-nav="trader">${icon('trader')}<span>商人</span></button>
    </nav>
    <div class="rail-bottom"><button class="nav-item" data-nav="help">${icon('help')}<span>遊び方</span></button><button class="nav-item" data-nav="settings">${icon('settings')}<span>設定</span></button><span class="version">v1.0</span></div>
  </aside>
  <div class="workspace">
    <header class="topbar">
      <div class="wordmark">ASHENFELL<span>灰 の 境 界</span></div>
      <div class="topbar-divider"></div><span class="topbar-caption">MEDIEVAL EXTRACTION RPG</span>
      <div class="topbar-right"><span class="alpha-badge">EARLY ACCESS</span><div class="currency">${icon('coin')}<b id="coins">${fmt(save.coins)}</b><span>銀貨</span></div><button class="profile" data-nav="settings" aria-label="プレイヤー設定"><span class="avatar">${icon('shield')}</span><span><b id="profile-name">${esc(save.name)}</b><small>旅人 · LV <span id="level">${1 + Math.floor(save.escapes / 3)}</span></small></span>${icon('chevron')}</button></div>
    </header>
    <main>
      <section class="page-heading"><div><div class="eyebrow"><span></span> THE BORDERLANDS AWAIT</div><h1>次の遠征へ<span class="heading-dot">.</span></h1><p>生き延びろ。奪え。そして、持ち帰れ。</p></div><div class="mode-control"><span class="mode-label">プレイモード</span><div class="segmented" role="group" aria-label="プレイモード"><button class="selected" id="solo-mode">${icon('shield')}ソロ <span>PvE</span></button><button id="online-mode">${icon('users')}オンライン <span>PvPvE</span></button></div></div></section>
      <div class="raid-layout">
        <section class="map-panel" aria-label="黒松の辺境 戦場マップ">
          <canvas id="world" tabindex="0" aria-label="ゲーム画面。WASDで移動、マウスで照準、クリックで攻撃。タッチ端末ではパッドとボタンで操作します。出撃ボタンで開始。"></canvas>
          <div class="map-top"><div class="map-tag"><span class="live-dot"></span><span id="map-status">出撃可能エリア</span></div><button class="map-expand" id="map-button" title="戦域マップ (M)">${icon('compass')}<span>戦域情報</span></button></div>
          <div class="map-title" id="map-title"><div class="map-region">THE NORTHERN MARCHES <span>— 01</span></div><h2>黒松の辺境</h2><p>BLACKPINE FRONTIER</p><div class="map-chips"><span>${icon('clock')}12分</span><span>${icon('skull')}危険度：中</span><span>${icon('exit')}脱出地点 3</span></div></div>
          <div class="north">N<span>⌃</span><i></i></div>
          <div class="map-coordinates">N 48° 21′ &nbsp; E 12° 04′<span>ASHENFELL CARTOGRAPHIC SOCIETY</span></div>
          <div class="map-bottom" id="lobby-map-bottom"><div class="map-legend"><span><i class="legend-loot"></i>探索地点</span><span><i class="legend-exit"></i>脱出地点</span></div><div class="weather">${icon('leaf')}晩秋 <span>曇り · 8°C</span></div></div>
          <div class="game-hud hidden" id="game-hud"><div class="hud-rail" aria-hidden="true"></div><div class="raid-timer">${icon('clock')}<b id="timer">12:00</b><span>残り時間</span></div><div class="game-top-actions"><button id="pause-button" title="メニュー (Esc)">II</button><button id="fullscreen-button" class="fullscreen-button" title="全画面表示" aria-label="全画面表示" aria-pressed="false">${icon('fullscreen')}</button></div>${resourceOrbs()}<div class="hotbar"><button id="slot-primary" class="hot-slot selected"><kbd>1</kbd>${icon('sword')}<span id="slot-primary-label">近接</span></button><button id="slot-bow" class="hot-slot"><kbd>2</kbd>${icon('bow')}<span id="arrows">24</span></button><button id="slot-heal" class="hot-slot"><kbd>Q</kbd>${healingFlask()}<span id="heals">3</span></button><button id="slot-bag" class="hot-slot"><kbd>Tab</kbd>${icon('backpack')}<span id="bag-count">0/12</span></button></div><div id="interaction" class="interaction hidden"></div><div id="game-message" class="game-message"></div><div class="touch-controls"><div class="touch-pad"><button data-touch="w">↑</button><button data-touch="a">←</button><button data-touch="s">↓</button><button data-touch="d">→</button></div><div class="touch-actions"><button data-action="interact">E</button><button data-action="dodge">回避</button><button data-action="attack" class="touch-attack">${icon('sword')}</button></div></div></div>
          <div class="map-grain"></div>
        </section>
        <aside class="loadout-panel"><div class="panel-title"><div><span class="eyebrow">YOUR LOADOUT</span><h2 id="loadout-heading">出撃準備</h2></div>${icon('shield')}</div><div class="character-preview">${portrait}<div class="character-label"><span class="small-dot"></span>準備完了</div><span class="character-class">THE WANDERER</span><span class="character-number">I</span></div><div class="equipment-heading"><span>装備</span><span id="gear-heading-note">初期装備 · 支給品</span></div><button class="weapon-card" id="weapon-select" title="クリックで剣と刀を切り替え"><span class="weapon-illustration" id="weapon-icon">${icon('sword')}</span><span><small>メイン武器 <span class="tier" id="weapon-tier">I</span></small><b id="weapon-name">鉄のロングソード</b><em id="weapon-detail">斬撃 28 · 片手剣</em></span>${icon('chevron')}</button><div class="equipment-grid" id="equipment-grid"></div><button class="gear-sheet-button" id="gear-sheet">${icon('scroll')}装備とステータス<small>CHARACTER SHEET</small></button><div class="loadout-weight">${icon('backpack')}<span id="weight-text">持ち帰り容量</span><b id="weight-value">22.0 <small>kg</small></b></div><div class="deploy-section"><div class="deploy-note">${icon('help')}<span id="deploy-note">倒れると、遠征中の戦利品を失います。</span></div><button class="deploy-button" id="deploy">${icon('sword')}<span>出撃する<small>ENTER THE FRONTIER</small></span>${icon('chevron')}</button><div class="server-status"><span class="small-dot"></span><span id="server-label">ソロ遠征</span><span id="server-detail">ローカルセーブ</span></div></div></aside>
      </div>
      <section class="contracts-section"><div class="section-heading"><h2>${icon('scroll')}旅人への依頼<span>CONTRACTS</span></h2><button id="all-quests">すべての依頼 ${icon('chevron')}</button></div><div class="contract-grid" id="contract-grid"></div></section>
      <footer class="footer"><span>${icon('shield')}灰の中にも、帰る場所はある。</span><div><span class="footer-dot"></span>保存先：このブラウザ<span class="footer-separator">/</span><button id="controls-link">操作ガイド <kbd>?</kbd></button></div></footer>
    </main>
  </div>
  <div id="modal-root"></div><div id="toast" class="toast" role="status"></div>
`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const renderer = new Renderer($<HTMLCanvasElement>('world'));
function tone(frequency = 440, duration = .08, type: OscillatorType = 'sine') {
  if (save.volume <= 0) return;
  audio.tone(frequency, duration, type);
}
/** The Web Audio engine unlocks on the first gesture, per browser autoplay rules. */
function unlockAudio() {
  audio.unlock();
}
audio.setSfxVolume(save.volume);
audio.setAmbientVolume(save.ambientVolume);
audio.setFires(FIRES);
window.addEventListener('pointerdown', unlockAudio, { passive: true, capture: true });
window.addEventListener('keydown', unlockAudio, { capture: true });
document.addEventListener('visibilitychange', () => audio.setMuted(document.hidden));
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3500); }
function persist() { document.body.classList.toggle('reduced-motion', save.reducedMotion); if (!storeSave(save)) toast('保存できませんでした。ブラウザのストレージ設定を確認してください。'); $('coins').textContent = fmt(save.coins); $('profile-name').textContent = save.name; $('level').textContent = String(1 + Math.floor(save.escapes / 3)); renderContracts(); }
function renderContracts() { $('contract-grid').innerHTML = contracts.map((q, i) => `<button class="contract-card" data-contract="${q.id}"><div class="contract-icon">${icon(q.icon)}</div><div class="contract-text"><small>依頼 ${String(i + 1).padStart(2, '0')} <span>${save.claimed.includes(q.id) ? '達成済み' : '進行中'}</span></small><h3>${q.title}</h3><p>${q.desc}</p><div class="contract-progress"><i style="width:${Math.min(100, q.value() / q.goal * 100)}%"></i></div></div><div class="contract-reward">${icon('coin')}<b>${q.reward}</b><span>${Math.min(q.value(), q.goal)} / ${q.goal}</span></div></button>`).join(''); }
renderContracts();
function openModal(name: string, title: string, subtitle: string, content: string, extraClass = '') {
  clearInput(); currentModal = name; audio.ui('open');
  document.querySelectorAll<HTMLElement>('.nav-item[data-nav]').forEach(el => el.classList.toggle('active', el.dataset.nav === name));
  if (playing && mode === 'solo') paused = true;
  $('modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal ${extraClass}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="modal-heading"><div><span class="eyebrow">${subtitle}</span><h2 id="dialog-title">${title}</h2></div><button class="icon-button" id="close-modal" aria-label="閉じる">${icon('close')}</button></header><div class="modal-body">${content}</div></section></div>`;
  $('close-modal').onclick = closeModal;
  $('modal-root').querySelector('.modal-backdrop')!.addEventListener('click', event => { if (event.target === event.currentTarget && name !== 'result') closeModal(); });
  $('close-modal').focus();
}
function closeModal() {
  audio.setSfxVolume(save.volume); audio.setAmbientVolume(save.ambientVolume);
  audio.ui('close');
  if (currentModal === 'result') { returnToBase(); return; }
  if (currentModal === 'online' && connecting) { connecting = false; const pending = socket; socket = null; pending?.close(); }
  currentModal = ''; bagOpen = false; $('modal-root').innerHTML = ''; paused = false;
  document.querySelectorAll<HTMLElement>('[data-nav]').forEach(el => el.classList.toggle('active', el.dataset.nav === 'raid' && el.classList.contains('nav-item')));
  if (playing) $('world').focus();
}
function help() { openModal('help', '生き延びるために', 'FIELD GUIDE', `<div class="guide-intro">${icon('compass')}<p>ここは、王国が見捨てた灰の辺境。<br>物資を探し、敵を退け、<strong>脱出地点でEを5秒間</strong>押し続けて帰還しましょう。</p></div><div class="guide-steps"><div><b>01</b><h3>装備を組む</h3><p>剣・斧・槌・短刀・巨剣・弓・弩。防具は頭・胸・手・足・盾・護符・指輪の7箇所。</p></div><div><b>02</b><h3>探索する</h3><p>木箱・薬草・倒した敵の近くでE。12枠・22kgまで。拾った装備はTabから即装着。</p></div><div><b>03</b><h3>帰還する</h3><p>マップの緑の出口へ。帰還した物資は倉庫で保管。</p></div></div><div class="key-guide">${[['W A S D / ↑↓←→', '移動'], ['マウス', '照準'], ['左クリック', '攻撃・射撃'], ['Shift', '走る · スタミナ消費'], ['Space', '回避 · 短時間無敵'], ['1 / 2', '近接武器 / 弓'], ['Q', '治療薬 · HP +45'], ['E 長押し', '物資回収 / 脱出'], ['Tab', 'バックパック'], ['M', '戦域マップ'], ['Esc', 'メニュー · ソロのみ一時停止']].map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div><div class="notice">時間切れ・死亡・遠征の放棄では戦利品を失います。初期装備は無料で再支給されます。装備は「ノーマル→マジック→レア→ユニーク」の4レアリティ。レアは最大6つの修飾を、ユニークは固有效果を持ちます。タッチ端末では左下のパッドで移動、右下のボタンで攻撃・回避・回収。画面をドラッグして照準を合わせ、攻撃ボタンは近くの敵へ自動照準します。</div><button class="primary-button full" id="guide-done">準備はできた ${icon('chevron')}</button>`); $('guide-done').onclick = closeModal; }
function stash() {
  const total = bagValue(save.stash);
  const gear = save.stash.filter(isGear);
  const materials = save.stash.filter((e): e is Material => !isGear(e));
  openModal('stash', '旅人の倉庫', 'YOUR STASH', `<div class="stash-summary"><span>保管物資 <b>${save.stash.length}</b></span><span>売却価値 <b>${fmt(total)} 銀貨</b></span></div>${save.stash.length ? `${gear.length ? `<h3 class="subheading">装備品 <span>${gear.length}点</span></h3><div class="item-grid">${gear.map(g => gearCard(g, `<button class="small-button" data-equip="${g.id}">装備する</button>`)).join('')}</div>` : ''}${materials.length ? `<h3 class="subheading">物資</h3><div class="item-grid">${materials.map(m => materialCard(m)).join('')}</div>` : ''}<button class="primary-button full" id="visit-trader">商人と取引する ${icon('chevron')}</button>` : `<div class="empty-state">${icon('stash')}<h3>物語は、空の背嚢から。</h3><p>遠征で手に入れた物資は、無事に帰還するとここへ保管されます。</p><button class="primary-button" id="stash-start">遠征の準備へ ${icon('chevron')}</button></div>`}<p class="muted">倉庫と進行状況はこのブラウザに保存されます。オンライン時も経済データはローカル管理です。</p>`);
  if ($('visit-trader')) $('visit-trader').onclick = trader;
  if ($('stash-start')) $('stash-start').onclick = closeModal;
  document.querySelectorAll<HTMLButtonElement>('[data-equip]').forEach(b => b.onclick = () => equipFromStash(b.dataset.equip!));
}
function quests() {
  openModal('quests', '旅人への依頼', 'CONTRACT BOARD', `<p class="modal-description">境界の砦から届いた仕事。成果を持ち帰り、報酬を受け取ろう。</p><div class="quest-list">${contracts.map(q => `<div class="quest-row"><div class="quest-emblem">${icon(q.icon)}</div><div><h3>${q.title}</h3><p>${q.desc}</p><small>${Math.min(q.goal, q.value())} / ${q.goal}</small></div><div><b class="gold">${q.reward} 銀貨</b><button class="small-button" data-claim="${q.id}" ${q.value() < q.goal || save.claimed.includes(q.id) ? 'disabled' : ''}>${save.claimed.includes(q.id) ? '受取済み' : q.value() >= q.goal ? '報酬を受け取る' : '進行中'}</button></div></div>`).join('')}</div><div class="notice">討伐数は生還した遠征のみ記録されます。各依頼の報酬は一度だけ受け取れます。</div>`);
  document.querySelectorAll<HTMLButtonElement>('[data-claim]').forEach(b => b.onclick = () => { const q = contracts.find(q => q.id === b.dataset.claim)!; if (q.value() >= q.goal && !save.claimed.includes(q.id)) { save.coins += q.reward; save.claimed.push(q.id); persist(); quests(); audio.coin(); toast(`${q.reward}銀貨を受け取りました`); } });
}
function trader() {
  const value = bagValue(save.stash);
  const materials = save.stash.filter((e): e is Material => !isGear(e));
  const gear = save.stash.filter(isGear);
  const kinds = Array.from(new Set(materials.map(m => m.kind)));
  openModal('trader', '境界の行商人', 'THE TRAVELING MERCHANT', `<div class="merchant-quote">${icon('trader')}<p>「灰に埋もれたものにも、価値はある。<br>無事に帰ったのなら、見せてみな。」</p></div><div class="trade-balance">所持銀貨 <b>${fmt(save.coins)} ${icon('coin')}</b></div><h3 class="subheading">物資から売却</h3>${kinds.length ? `<div class="trade-items">${kinds.map(k => { const count = materials.filter(m => m.kind === k).reduce((s, i) => s + i.amount, 0); return `<div class="trade-row"><span class="trade-icon rarity-${ITEMS[k].rarity}">${icon(k)}</span><span><b>${ITEMS[k].name}</b><small>倉庫 ×${count}</small></span><button class="small-button" data-sell="${k}">すべて売る · ${fmt(count * ITEMS[k].value)}</button></div>`; }).join('')}</div>` : ''}${gear.length ? `<h3 class="subheading">装備品から売却</h3><div class="trade-items">${gear.map(g => `<div class="trade-row"><span class="trade-icon rarity-${g.rarity}">${icon(baseOf(g)?.icon ?? 'shield')}</span><span><b style="color:${RARITIES[g.rarity].color}">${g.name}</b><small>アイテムレベル ${g.ilvl} · ${RARITIES[g.rarity].label}</small></span><button class="small-button" data-sell-gear="${g.id}">売る · ${fmt(entryValue(g))}</button></div>`).join('')}</div>` : ''}${save.stash.length ? `<button class="primary-button full" id="sell-all">物資をすべて売却 ${icon('coin')} ${fmt(value)}</button>` : '<div class="trade-empty">売却できる物資がありません。遠征で探してみましょう。</div>'}<div class="notice">支給装備・矢・治療薬は毎回無料です。売却した銀貨と依頼報酬が旅の成果として蓄積されます。</div>`);
  document.querySelectorAll<HTMLButtonElement>('[data-sell]').forEach(b => b.onclick = () => { const k = b.dataset.sell as keyof typeof ITEMS; const sold = save.stash.filter((i): i is Material => !isGear(i) && i.kind === k); save.coins += bagValue(sold); save.stash = save.stash.filter(i => isGear(i) || i.kind !== k); persist(); trader(); audio.coin(); toast(`${ITEMS[k].name}を売却しました`); });
  document.querySelectorAll<HTMLButtonElement>('[data-sell-gear]').forEach(b => b.onclick = () => { const id = b.dataset.sellGear!; const gearEntry = save.stash.find((i): i is Gear => isGear(i) && i.id === id); if (!gearEntry) return; save.coins += entryValue(gearEntry); save.stash = save.stash.filter(i => !(isGear(i) && i.id === id)); persist(); trader(); audio.coin(); toast(`${gearEntry.name}を売却しました`); });
  if ($('sell-all')) $('sell-all').onclick = () => { save.coins += bagValue(save.stash); save.stash = []; persist(); trader(); audio.coin(); toast('すべての物資を売却しました'); };
}
function settings() {
  openModal('settings', '旅の設定', 'PREFERENCES', `<label class="setting-row"><span><b>旅人の名前</b><small>オンラインの戦場でも表示されます</small></span><input id="name-input" type="text" maxlength="16" value="${esc(save.name)}" /></label><label class="setting-row"><span><b>効果音</b><small>攻撃・被弾・操作の音量</small></span><input id="volume-input" type="range" min="0" max="100" value="${save.volume * 100}" aria-label="効果音の音量" /></label><label class="setting-row"><span><b>環境音</b><small>風・焚き火・獣の声の音量</small></span><input id="ambient-input" type="range" min="0" max="100" value="${save.ambientVolume * 100}" aria-label="環境音の音量" /></label><button class="secondary-button full" id="test-attack-sound" type="button">攻撃音を試す</button><label class="setting-row"><span><b>演出を抑える</b><small>漂う灰のアニメーションを停止</small></span><input id="motion-input" type="checkbox" ${save.reducedMotion ? 'checked' : ''} /></label><div class="notice">ソロではメニューを開くと一時停止します。オンラインの戦場はメニュー表示中も進行します。データはこの端末のブラウザに保存されます。</div><button class="primary-button full" id="save-settings">設定を保存 ${icon('check')}</button>`);
  $('test-attack-sound').onclick = () => {
    const volume = Number($<HTMLInputElement>('volume-input').value) / 100;
    audio.setSfxVolume(volume);
    audio.setAmbientVolume(Number($<HTMLInputElement>('ambient-input').value) / 100);
    audio.unlock();
    if (volume === 0) { toast('効果音が0です。音量を上げてからお試しください。'); return; }
    audio.attack('sword');
  };
  $('save-settings').onclick = () => { save.name = $<HTMLInputElement>('name-input').value.trim().slice(0, 16) || '名もなき旅人'; save.volume = Number($<HTMLInputElement>('volume-input').value) / 100; save.ambientVolume = Number($<HTMLInputElement>('ambient-input').value) / 100; save.reducedMotion = $<HTMLInputElement>('motion-input').checked; audio.setSfxVolume(save.volume); audio.setAmbientVolume(save.ambientVolume); persist(); tone(); closeModal(); toast('設定を保存しました'); };
}
function backpack() {
  const p = getPlayer(); if (!p || !playing) return;
  bagOpen = true;
  const gear = p.bag.filter(isGear);
  const materials = p.bag.filter((e): e is Material => !isGear(e));
  const loadoutHtml = SLOTS.map(slot => {
    const worn = p.loadout[slot];
    const info = worn ? RARITIES[worn.rarity] : null;
    return `<div class="equipped-row${worn ? ` rarity-${worn.rarity}` : ' empty'}"><span class="equipped-icon">${icon(SLOT_ICONS[slot])}</span><span><small>${SLOT_LABELS[slot]}</small><b${worn ? ` style="color:${info!.color}"` : ''}>${worn ? worn.name : '装備なし'}</b></span>${worn ? `<em>${gearSummary(worn)}</em>` : ''}</div>`;
  }).join('');
  openModal('bag', '遠征のバックパック', 'FIELD INVENTORY', `<div class="stash-summary"><span>容量 <b>${p.bag.length} / 12</b></span><span>重量 <b>${bagWeight(p.bag).toFixed(1)} / 22.0 kg</b></span></div><h3 class="subheading">現在の装備 <span>EQUIPPED</span></h3><div class="equipped-list">${loadoutHtml}</div><h3 class="subheading">装備品 <span>GEAR</span></h3>${gear.length ? `<div class="item-grid">${gear.map(g => gearCard(g, `<button class="small-button" data-field-equip="${g.id}">装備</button>`)).join('')}</div>` : '<p class="muted">装備品はまだ見つかっていません。</p>'}<h3 class="subheading">物資 <span>MATERIALS</span></h3><div class="item-grid">${materials.map(m => materialCard(m)).join('')}${Array.from({ length: Math.max(0, 12 - p.bag.length) }, () => '<div class="item-card empty">＋</div>').join('')}</div><div class="notice">生還した場合の売却価値：<strong>${fmt(bagValue(p.bag))} 銀貨</strong><br>装備すると外していた装備がバックパックへ戻ります。${mode === 'online' ? 'オンライン遠征は進行中です。' : 'ソロ遠征は一時停止中です。'}</div>`);
  document.querySelectorAll<HTMLButtonElement>('[data-field-equip]').forEach(b => b.onclick = () => { const g = p.bag.find(i => isGear(i) && i.id === b.dataset.fieldEquip); if (mode === 'online' && g && isGear(g)) { socket?.send(JSON.stringify({ type: 'equip', id: g.id })); toast('装備変更を送信しました'); return; } if (g && isGear(g) && equipInField(p, g)) { audio.equip(); toast(`${g.name}を装備した`); backpack(); } });
}
function pauseMenu() { if (!playing) return; openModal('pause', mode === 'solo' ? '焚き火のひと休み' : '遠征メニュー', 'RAID MENU', `<div class="pause-emblem">${icon('fire')}</div><p class="center muted">${mode === 'solo' ? 'ソロ遠征を一時停止しています。' : 'オンラインの戦場は進行しています。'}</p><div class="button-stack"><button class="primary-button" id="resume">遠征を続ける ${icon('chevron')}</button><button class="secondary-button" id="pause-help">操作ガイド</button><button class="danger-button" id="abandon">遠征を放棄する</button></div><p class="muted center">放棄すると、今回の戦利品は失われます。</p>`); $('resume').onclick = closeModal; $('pause-help').onclick = help; $('abandon').onclick = () => { openModal('abandon', '遠征を放棄しますか？', 'LEAVE THE FRONTIER', `<p class="modal-description">今回の戦利品はすべて失われます。倉庫の物資は失われません。</p><div class="button-stack"><button class="danger-button" id="confirm-abandon">戦利品を失って拠点に戻る</button><button class="secondary-button" id="cancel-abandon">遠征を続ける</button></div>`); $('confirm-abandon').onclick = () => { save.raids++; persist(); returnToBase(); toast('遠征を放棄しました'); }; $('cancel-abandon').onclick = closeModal; }; }
function setMode(next: 'solo' | 'online') {
  if (playing || connecting) return;
  if (next === 'online' && staticHost) { toast('GitHub Pages版はソロ専用です。オンラインPvPvEはCloudflare版で利用できます。'); return; }
  mode = next; $('solo-mode').classList.toggle('selected', next === 'solo'); $('online-mode').classList.toggle('selected', next === 'online');
  $('server-label').textContent = next === 'solo' ? 'ソロ遠征' : 'オンライン遠征'; $('server-detail').textContent = next === 'solo' ? (staticHost ? 'GitHub Pages · ソロ版' : 'ローカルセーブ') : onlineAvailable ? 'サーバー接続可能' : 'Cloudflare接続が必要';
  $('deploy-note').textContent = next === 'solo' ? '倒れると、遠征中の戦利品を失います。' : '同じ合言葉の旅人とPvPvE。最大8人。';
}
function getPlayer() { return game.players.find(p => p.id === playerId); }
function nearestTarget(p: Player, range: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null, bestD = range;
  for (const e of game.enemies) { if (e.hp <= 0) continue; const d = distance(p, e); if (d < bestD) { bestD = d; best = e; } }
  for (const o of game.players) { if (o.id === playerId || o.status !== 'alive') continue; const d = distance(p, o); if (d < bestD) { bestD = d; best = o; } }
  return best;
}
/** The gear the traveller would wear right now: the saved loadout plus the issued starters. */
function currentLoadout(): Partial<Record<Slot, Gear>> {
  const loadout: Partial<Record<Slot, Gear>> = { ...save.loadout };
  if (!loadout.melee) loadout.melee = starterMelee(save.meleeChoice);
  if (!loadout.bow) loadout.bow = STARTER_GEAR.bow;
  return loadout;
}

/** Moves a piece of gear from the stash into the worn slot, returning the old one to the stash. */
function equipFromStash(gearId: string) {
  const index = save.stash.findIndex(entry => isGear(entry) && entry.id === gearId);
  if (index < 0) return;
  const gear = save.stash[index] as Gear;
  if (!SLOTS.includes(gear.slot)) return;
  save.stash.splice(index, 1);
  const previous = save.loadout[gear.slot];
  save.loadout[gear.slot] = gear;
  if (previous) save.stash.push(previous);
  persist();
  renderLoadout();
  toast(`${gear.name}を装備しました`);
  audio.equip();
  if (currentModal === 'gear' || currentModal === 'stash') characterSheet();
}

/** Takes a worn piece off and puts it back into the stash. */
function unequipSlot(slot: Slot) {
  const gear = save.loadout[slot];
  if (!gear) return;
  delete save.loadout[slot];
  save.stash.push(gear);
  persist();
  renderLoadout();
  toast(`${gear.name}を外しました`);
  audio.ui('close');
  if (currentModal === 'gear') characterSheet();
}

/** Redraws the lobby equipment panel from the saved loadout. */
function renderLoadout() {
  const loadout = currentLoadout();
  const melee = loadout.melee!;
  const meleeProfile = weaponProfile(melee, globalStats(loadout));
  $('weapon-name').textContent = melee.name;
  $('weapon-name').style.color = RARITIES[melee.rarity].color;
  $('weapon-detail').textContent = `物理 ${meleeProfile.min}-${meleeProfile.max} · ${meleeProfile.attackSpeed.toFixed(2)}/秒 · ${RARITIES[melee.rarity].label}`;
  $('weapon-tier').textContent = `Lv ${melee.ilvl}`;
  $('weapon-icon').innerHTML = weaponArt(meleeProfile.kind, baseOf(melee)?.icon ?? 'sword');
  $('gear-heading-note').textContent = Object.keys(save.loadout).length ? `装備 ${Object.keys(save.loadout).length} / ${SLOTS.length}` : '初期装備 · 支給品';
  $('equipment-grid').innerHTML = slotGrid(save.loadout, { melee: starterMelee(save.meleeChoice), bow: STARTER_GEAR.bow });
  $('equipment-grid').querySelectorAll<HTMLElement>('[data-slot]').forEach(el => el.onclick = () => characterSheet(el.dataset.slot as Slot));
}

/** The character sheet: worn gear on the left, the stash of spares on the right. */
function characterSheet(focusSlot?: Slot) {
  if (playing || connecting) return;
  const loadout = currentLoadout();
  const globals = globalStats(loadout);
  const spareGear = save.stash.filter(isGear);
  const sheet = characterSheetHtml(loadout, globals, {
    meleeDps: weaponDps(loadout.melee ?? null, globals),
    bowDps: weaponDps(loadout.bow ?? null, globals),
    life: 100 + globals.life,
    stamina: 100 + globals.stamina,
  });
  const spares = spareGear.length ? `<div class="item-grid">${spareGear.map(g => gearCard(g, `<button class="small-button" data-equip="${g.id}">装備</button>`)).join('')}</div>` : '<p class="muted">予備の装備はありません。遠征で探しましょう。</p>';
  const detail = focusSlot && loadout[focusSlot]
    ? `<h3 class="subheading">${SLOT_LABELS[focusSlot]}の詳細<span>DETAIL</span></h3>${gearTooltip(loadout[focusSlot]!)}`
    : '';
  openModal('gear', '旅人の装備', 'CHARACTER SHEET', `${sheet}<button class="secondary-button" id="starter-toggle">支給武器：${save.meleeChoice === 'sword' ? '剣' : '刀'}（切替）</button>${detail}<h3 class="subheading">予備の装備<span>SPARE GEAR</span></h3>${spares}<p class="muted">装備は拠点で変更できます。遠征中はバックパック（Tab）から装備し替えられます。</p>`);
  document.querySelectorAll<HTMLButtonElement>('[data-equip]').forEach(b => b.onclick = () => equipFromStash(b.dataset.equip!));
  document.querySelectorAll<HTMLElement>('.doll-slot.filled').forEach(el => el.onclick = () => characterSheet(el.dataset.slot as Slot));
  document.querySelectorAll<HTMLElement>('.doll-slot.filled').forEach(el => {
    const slot = el.dataset.slot as Slot;
    el.insertAdjacentHTML('beforeend', `<button class="small-button unequip" data-unequip="${slot}">外す</button>`);
  });
  $('starter-toggle').onclick = () => { save.meleeChoice = save.meleeChoice === 'sword' ? 'katana' : 'sword'; persist(); renderLoadout(); characterSheet(); };
  document.querySelectorAll<HTMLButtonElement>('[data-unequip]').forEach(b => b.onclick = event => { event.stopPropagation(); unequipSlot(b.dataset.unequip as Slot); });
}
function enterRaid() {
  playing = true; paused = false; resultShown = false; mapOpen = false; bagOpen = false; gameStartedAt = game.time; raidStartLoadout = { ...save.loadout }; accumulator = 0; lastAttack = { attackSerial: 0, cooldown: 0, swing: 0 }; lastHp = 100; lastBag = 0; lastEs = 0; lastHeals = 3; lastDodge = 0; stepAt = 0; extractTickAt = 0; enemyAudioState.clear(); alertedEnemies.clear(); currentModal = ''; $('modal-root').innerHTML = ''; clearInput(); input.weapon = 'melee';
  document.body.classList.add('in-raid'); $('game-hud').classList.remove('hidden'); $('map-title').classList.add('hidden'); $('lobby-map-bottom').classList.add('hidden'); $('map-status').textContent = mode === 'solo' ? 'ソロ遠征 · PvE' : 'オンライン · PvPvE'; $('loadout-heading').textContent = '遠征中'; $('deploy').innerHTML = `${icon('backpack')}<span>バックパック<small>FIELD INVENTORY</small></span>${icon('chevron')}`;
  const p = getPlayer();
  const melee = p ? meleeGear(p) : null;
  $('slot-primary').innerHTML = `<kbd>1</kbd>${weaponArt(p ? weaponKind(p) : 'sword', melee ? baseOf(melee)?.icon ?? 'sword' : 'sword')}<span id="slot-primary-label">近接</span>`;
  $('slot-bow').innerHTML = `<kbd>2</kbd>${icon('bow')}<span id="arrows">${p?.arrows ?? 24}</span>`;
  $('world').focus(); audio.setScene('raid'); audio.warHorn(); toast('物資を探して、緑の脱出地点へ。Eを5秒長押しで帰還。');
}
function startSolo() { mode = 'solo'; game = makeGame(); playerId = 'local'; addPlayer(game, playerId, save.name, save.meleeChoice, save.loadout); enterRaid(); }
function connectOnline(room: string) {
  if (connecting) return;
  connecting = true; $('connect-room').textContent = '戦場に接続中…'; $<HTMLButtonElement>('connect-room').disabled = true;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/raid?room=${encodeURIComponent(room)}&name=${encodeURIComponent(save.name)}&weapon=${save.meleeChoice}&loadout=${encodeURIComponent(encodeLoadout(save.loadout))}`);
  socket = ws;
  const timeout = setTimeout(() => { if (connecting) { ws.close(); fail(); } }, 9000);
  let joined = false;
  const fail = () => { clearTimeout(timeout); if (socket !== ws) return; connecting = false; if (!joined) { if ($('connect-room')) { $('connect-room').textContent = 'もう一度接続する'; $<HTMLButtonElement>('connect-room').disabled = false; } if ($('connection-error')) $('connection-error').textContent = '接続できませんでした。Cloudflare版で開くか、別の合言葉をお試しください。ローカルでは npm run dev:cloudflare が必要です。'; } };
  ws.onmessage = event => {
    try { const data = JSON.parse(event.data); if (data.type === 'joined') { clearTimeout(timeout); if (socket !== ws) { ws.close(); return; } connecting = false; joined = true; game = data.state; playerId = data.id; enterRaid(); $('server-detail').textContent = `戦場：${room}`; } else if (data.type === 'state' && socket === ws && playing) game = data.state; } catch { toast('サーバー応答を読み込めませんでした'); }
  };
  ws.onerror = () => { if (!joined) fail(); };
  ws.onclose = () => { clearTimeout(timeout); if (!joined) fail(); else if (playing && !resultShown && socket === ws) { save.raids++; persist(); returnToBase(); toast('接続が切れました。未脱出の戦利品は持ち帰れません。'); } };
}
function deploy() {
  if (playing) { backpack(); return; }
  if (mode === 'solo') { startSolo(); return; }
  openModal('online', '共に入るか、敵として会うか。', 'ONLINE PvPvE', `<div class="guide-intro">${icon('users')}<p>同じ合言葉を入力した最大8人が、同じ戦場に参加します。<strong>ほかの旅人にも攻撃が当たります。</strong></p></div><label class="room-label" for="room-input">戦場の合言葉</label><input class="room-input" id="room-input" value="blackpine" maxlength="24" pattern="[a-zA-Z0-9-]{1,24}" autocomplete="off" spellcheck="false" /><p class="muted">半角英数字とハイフン、1〜24文字。友人に同じ合言葉を伝えてください。</p><p class="connection-error" id="connection-error" role="status"></p><button class="primary-button full" id="connect-room">戦場に接続する ${icon('chevron')}</button><div class="notice">戦闘はCloudflare Durable Objectsで同期されます。切断時は遠征放棄となり、再接続による戦利品の復元はありません。</div>`);
  $('connect-room').onclick = () => { const room = $<HTMLInputElement>('room-input').value.trim(); if (!/^[a-zA-Z0-9-]{1,24}$/.test(room)) { $('connection-error').textContent = '合言葉は半角英数字とハイフンで1〜24文字にしてください。'; return; } connectOnline(room); };
}
function returnToBase() {
  playing = false; connecting = false; resultShown = false; const old = socket; socket = null; old?.close(); game = makeGame(); playerId = 'local'; currentModal = ''; paused = false; mapOpen = false; clearInput(); $('modal-root').innerHTML = ''; document.body.classList.remove('in-raid'); leaveImmersive(); $('game-hud').classList.add('hidden'); $('map-title').classList.remove('hidden'); $('lobby-map-bottom').classList.remove('hidden'); $('map-status').textContent = '出撃可能エリア'; $('loadout-heading').textContent = '出撃準備'; $('deploy').innerHTML = `${icon('sword')}<span>出撃する<small>ENTER THE FRONTIER</small></span>${icon('chevron')}`; $('weight-text').textContent = '持ち帰り容量'; $('weight-value').innerHTML = '22.0 <small>kg</small>'; setMode(mode); renderLoadout(); audio.setScene('lobby');
}
function finishRaid(p: Player) {
  if (resultShown) return;
  resultShown = true; clearInput(); const finishedSocket = socket; socket = null; finishedSocket?.close(); const survived = p.status === 'extracted'; save.raids++;
  if (survived) {
    // The gear worn at the moment of extraction stays worn; everything else in the bag comes home loose.
    for (const slot of SLOTS) { const gear = p.loadout[slot]; if (gear) save.loadout[slot] = gear; }
    save.stash.push(...p.bag);
    save.escapes++; save.kills += p.kills; save.collected += p.bag.reduce((s, i) => s + (isGear(i) ? 1 : i.amount), 0);
  } else {
    // A failed raid costs the gear that was found inside it, but the issued kit stays.
    save.loadout = { ...raidStartLoadout };
  }
  persist(); if (survived) audio.extract(); else audio.ui('fail');
  const elapsed = Math.floor(game.time - gameStartedAt);
  openModal('result', survived ? '灰の向こうへ、生還。' : '辺境に、名を残して。', survived ? 'EXTRACTION SUCCESSFUL' : 'LOST IN THE FRONTIER', `<div class="result-emblem ${survived ? 'success' : 'failure'}">${icon(survived ? 'exit' : 'skull')}</div><p class="center muted">${survived ? '戦利品は倉庫に届けられました。次の物語は、焚き火のそばで。' : game.ended ? '遠征時間が終了しました。戦利品は失われました。' : '倒れてしまいました。戦利品は失われましたが、次の遠征が待っています。'}</p><div class="result-stats"><div><small>遠征時間</small><b>${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}</b></div><div><small>討伐数</small><b>${p.kills}</b></div><div><small>持ち帰り価値</small><b>${survived ? fmt(bagValue(p.bag)) : 0}<small> 銀貨</small></b></div></div>${survived && p.bag.length ? `<div class="result-loot">${p.bag.map(i => entryLabel(i)).join('')}</div>` : ''}<button class="primary-button full" id="return-base">拠点へ戻る ${icon('chevron')}</button>`, 'result-modal'); $('return-base').onclick = returnToBase;
}
function clearInput() { keys.clear(); input.x = 0; input.y = 0; input.attack = false; input.interact = false; input.heal = false; input.dodge = false; input.sprint = false; mouseAttack = false; aimPointer = null; cursorWorld = null; touchState.attack = false; touchState.interact = false; touchState.dodge = false; }
function toggleMap() { if (!playing) { openModal('map-info', '黒松の辺境', 'THE NORTHERN MARCHES', `<div class="map-info-art">${icon('compass')}</div><p class="modal-description">古い交易路に沿って、朽ちた村と修道院が点在する森林地帯。野盗と狼が徘徊し、価値ある遺物が打ち捨てられています。</p><div class="guide-steps"><div><b>01</b><h3>巡礼者の小道</h3><p>南西。出撃地点から最も近い脱出路。</p></div><div><b>02</b><h3>北の見張り門</h3><p>北東。修道院の先にある古い門。</p></div><div><b>03</b><h3>渡し守の桟橋</h3><p>南東。野営地を越え、川沿いへ。</p></div></div><div class="notice">12分以内に帰還してください。戦場ではMキーで全体マップを表示できます。川は浅瀬として通行可能です。</div>`); } else if (!currentModal) { mapOpen = !mapOpen; } }
function updateHUD() {
  const p = getPlayer(); if (!p) return;
  const seconds = Math.max(0, Math.ceil(game.duration - game.time)); $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; $('timer').classList.toggle('danger-text', seconds < 90);
  const hpPercent = resourcePercent(p.hp, p.maxHp), staminaMax = 100 + p.globals.stamina;
  $('hp-bar').style.height = `${hpPercent}%`; $('st-bar').style.height = `${resourcePercent(p.stamina, staminaMax)}%`;
  $('life-orb').classList.toggle('low-resource', hpPercent < 25);
  $('hp-max').textContent = `/ ${Math.ceil(p.maxHp)}`; $('st-max').textContent = `/ ${Math.ceil(staminaMax)}`;
  for (const [id, value, max] of [['life-orb', p.hp, p.maxHp], ['stamina-orb', p.stamina, staminaMax]] as const) {
    $(id).setAttribute('aria-valuenow', String(Math.max(0, Math.ceil(value))));
    $(id).setAttribute('aria-valuemax', String(Math.ceil(max)));
  }
   $('hp-label').textContent = String(Math.ceil(p.hp)); $('st-label').textContent = String(Math.ceil(p.stamina)); $('arrows').textContent = String(p.arrows); $('heals').textContent = String(p.heals); $('bag-count').textContent = `${p.bag.length}/12`;
  $('slot-primary').classList.toggle('selected', input.weapon !== 'bow'); $('slot-bow').classList.toggle('selected', input.weapon === 'bow'); $('es-bar').style.width = `${p.globals.energyShield ? p.es / p.globals.energyShield * 100 : 0}%`; $('es-label').textContent = String(Math.ceil(p.es)); $('weight-text').textContent = `戦利品 ${p.bag.length}/12`; $('weight-value').innerHTML = `${bagWeight(p.bag).toFixed(1)} <small>/22 kg</small>`;
  if (mode === 'online') $('server-label').textContent = `旅人 ${game.players.filter(p => p.status === 'alive').length}/8`;
  const exit = EXITS.find(e => distance(p, e) < 65), loot = game.loot.find(l => !l.opened && distance(p, l) < 74);
  $('interaction').classList.toggle('hidden', (!exit && !loot) || p.status !== 'alive');
  if (exit) $('interaction').innerHTML = `<kbd>E</kbd><span>${exit.name}<small>長押しで脱出 · ${Math.max(0, 5 - p.extraction).toFixed(1)}秒</small></span><div class="extraction-bar"><i style="width:${p.extraction / 5 * 100}%"></i></div>`;
  else if (loot) $('interaction').innerHTML = `<kbd>E</kbd><span>${loot.kind === 'herb' ? '薬草を採取する' : loot.kind === 'body' ? '所持品を調べる' : '物資を回収する'}<small>${loot.items.length}点のアイテム</small></span>`;
  $('game-message').textContent = p.messageTime > 0 ? p.message : '';
  if (p.status !== 'alive') finishRaid(p);
}

// UI actions.
document.querySelectorAll<HTMLElement>('[data-nav]').forEach(el => el.onclick = () => { const nav = el.dataset.nav; if (connecting) { toast('接続処理が終わるまでお待ちください'); return; } if (playing && ['stash', 'trader', 'quests'].includes(nav!)) { toast('このメニューは拠点で利用できます'); return; } ({ raid: () => currentModal ? closeModal() : playing ? pauseMenu() : void 0, stash, quests, trader, help, settings } as Record<string, () => void>)[nav!]?.(); });
document.querySelector('.brand-mark')!.addEventListener('click', e => { e.preventDefault(); if (playing) pauseMenu(); else closeModal(); });
renderLoadout();
$('solo-mode').onclick = () => setMode('solo'); $('online-mode').onclick = () => setMode('online'); $('weapon-select').onclick = () => characterSheet('melee'); $('gear-sheet').onclick = () => characterSheet(); $('deploy').onclick = deploy; $('all-quests').onclick = () => playing ? toast('依頼は拠点で確認できます') : quests(); $('contract-grid').onclick = () => playing ? toast('依頼は拠点で確認できます') : quests(); $('controls-link').onclick = help; $('map-button').onclick = toggleMap; $('pause-button').onclick = pauseMenu;
$('slot-primary').onclick = () => { input.weapon = 'melee'; }; $('slot-bow').onclick = () => { input.weapon = 'bow'; }; $('slot-heal').onclick = () => { input.heal = true; setTimeout(() => input.heal = false, 150); }; $('slot-bag').onclick = backpack;

// Mobile immersive raid: use the Fullscreen API when available, otherwise hide the site chrome with body.immersive-raid (iOS Safari, embedded browsers).
const fullscreenButton = $<HTMLButtonElement>('fullscreen-button');
const isImmersive = () => document.body.classList.contains('immersive-raid');
function syncFullscreenButton() {
  const on = isImmersive();
  fullscreenButton.innerHTML = icon(on ? 'exitFullscreen' : 'fullscreen');
  fullscreenButton.title = on ? '全画面を解除' : '全画面表示';
  fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
  fullscreenButton.setAttribute('aria-pressed', String(on));
}
function setImmersive(on: boolean) { document.body.classList.toggle('immersive-raid', on); syncFullscreenButton(); }
async function enterImmersive() {
  const root = document.documentElement;
  if (typeof root.requestFullscreen === 'function' && document.fullscreenEnabled && !document.fullscreenElement) {
    try { await root.requestFullscreen(); setImmersive(true); return; } catch { /* The browser refused; use the layout fallback below. */ }
  }
  setImmersive(true);
}
function leaveImmersive() {
  setImmersive(false);
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}
fullscreenButton.onclick = () => { if (isImmersive()) leaveImmersive(); else void enterImmersive(); };
// Leaving native fullscreen with the system gesture or Esc must also restore the normal layout.
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && isImmersive()) setImmersive(false); });
syncFullscreenButton();

window.addEventListener('keydown', e => {
  if (currentModal && e.key === 'Tab') {
    e.preventDefault();
    if (bagOpen) { closeModal(); return; }
    const focusable = [...$('modal-root').querySelectorAll<HTMLElement>('button:not(:disabled), input')];
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    focusable[(index + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length]?.focus();
    return;
  }
  if ((e.target as HTMLElement).matches('input, textarea')) { if (e.key === 'Escape') closeModal(); return; }
  if (e.key === 'Escape') { e.preventDefault(); currentModal ? closeModal() : playing ? pauseMenu() : void 0; return; }
  if (e.key === '?' && !currentModal) { help(); return; }
  if (currentModal) return;
  if (!playing) return;
  const key = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab', 'shift', 'q', 'e', '1', '2', 'm'].includes(key)) e.preventDefault();
  keys.add(key);
  if (key === '1') input.weapon = 'melee'; if (key === '2') input.weapon = 'bow';
  if (key === 'tab' && !e.repeat) backpack(); if (key === 'm' && !e.repeat) toggleMap();
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => { clearInput(); if (playing && mode === 'solo' && !currentModal) pauseMenu(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInput(); if (playing && mode === 'solo' && !currentModal) pauseMenu(); } });
const canvas = $<HTMLCanvasElement>('world');
const aimAt = (e: PointerEvent) => {
  const rect = canvas.getBoundingClientRect();
  const pos = renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const p = getPlayer();
  cursorWorld = pos;
  if (p) input.angle = Math.atan2(pos.y - p.y, pos.x - p.x);
};
canvas.addEventListener('pointermove', e => { if (!playing || currentModal) return; if (e.pointerType === 'mouse' || aimPointer === e.pointerId) aimAt(e); });
canvas.addEventListener('pointerdown', e => {
  if (!playing || currentModal) return;
  canvas.focus();
  if (e.pointerType === 'mouse') {
    aimAt(e);
    if (e.button === 0) { mouseAttack = true; canvas.setPointerCapture(e.pointerId); }
  } else {
    // Touch/pen drags use the actual finger position; at rest the reticle sits 150px along the aim direction.
    aimPointer = e.pointerId; canvas.setPointerCapture(e.pointerId); aimAt(e);
  }
});
window.addEventListener('pointerup', e => {
  if (e.pointerType === 'mouse') mouseAttack = false;
  if (aimPointer === e.pointerId) { aimPointer = null; cursorWorld = null; }
});
canvas.addEventListener('pointercancel', clearInput);
canvas.addEventListener('contextmenu', e => e.preventDefault());
const touchState = { attack: false, interact: false, dodge: false };
document.querySelectorAll<HTMLButtonElement>('[data-touch]').forEach(b => { const key = b.dataset.touch!; b.onpointerdown = e => { e.preventDefault(); b.setPointerCapture(e.pointerId); keys.add(key); }; b.onpointerup = b.onpointercancel = () => keys.delete(key); });
document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(b => { const action = b.dataset.action as keyof typeof touchState; b.onpointerdown = e => { e.preventDefault(); b.setPointerCapture(e.pointerId); touchState[action] = true; }; b.onpointerup = b.onpointercancel = () => { touchState[action] = false; }; });
let last = performance.now(), accumulator = 0, lastHp = 100, lastBag = 0;
// ---- combat audio bookkeeping: the engine is driven by diffs of the authoritative state ----
const enemyAudioState = new Map<string, { hp: number; swing: number }>();
const alertedEnemies = new Set<string>();
let lastEs = 0, lastHeals = 3, lastDodge = 0, stepAt = 0, extractTickAt = 0;
let lastAttack: AttackSnapshot = { attackSerial: 0, cooldown: 0, swing: 0 };
/** Turns state changes since the previous frame into positioned sounds: swings, hits, deaths, steps. */
function syncCombatAudio(p: Player, dt: number) {
  audio.setListener(p.x, p.y);
  if (attackStarted(lastAttack, p)) audio.attack(weaponKind(p), p.x, p.y);
  if (p.hp <= 0 && lastHp > 0) audio.death('player', p.x, p.y);
  else if (p.hp < lastHp) audio.hurt(p.x, p.y);
  else if (p.es < lastEs && p.hp === lastHp) audio.block(p.x, p.y);
  if (p.dodge > lastDodge && p.dodge > 0) audio.dodge(p.x, p.y);
  if (p.heals < lastHeals) audio.heal();
  if (p.bag.length > lastBag) {
    const gained = p.bag[p.bag.length - 1];
    if (gained && isGear(gained) && gained.rarity !== 'normal') audio.pickupRare(p.x, p.y);
    else audio.pickup(p.x, p.y);
  }
  // Enemy swings, impacts and deaths, thinned by distance so the mix never stacks up.
  for (const enemy of game.enemies) {
    const prev = enemyAudioState.get(enemy.id) ?? { hp: enemy.hp, swing: enemy.swing };
    const d = distance(p, enemy);
    if (enemy.hp < prev.hp && d < 900) {
      const loss = prev.hp - enemy.hp;
      if (enemy.hp <= 0) audio.death(enemy.kind, enemy.x, enemy.y);
      else audio.impact({ material: enemy.kind === 'knight' ? 'metal' : 'flesh', crit: loss >= 22, heavy: loss >= 30 }, enemy.x, enemy.y);
    }
    if (enemy.swing > prev.swing && enemy.hp > 0 && d < 760) audio.enemyAttack(enemy.kind, enemy.x, enemy.y);
    if (enemy.hp > 0) {
      if (d < 220 && !alertedEnemies.has(enemy.id)) { alertedEnemies.add(enemy.id); if (d < 620) audio.alert(enemy.kind, enemy.x, enemy.y); }
      else if (d > 470) alertedEnemies.delete(enemy.id);
    }
    enemyAudioState.set(enemy.id, { hp: enemy.hp, swing: enemy.swing });
  }
  // Boots on ash while the traveller is actually moving.
  const moving = p.status === 'alive' && (input.x !== 0 || input.y !== 0) && p.dodge <= 0;
  if (moving) {
    stepAt -= dt;
    if (stepAt <= 0) { stepAt = input.sprint ? .27 : .38; audio.footstep(input.sprint, p.x, p.y); }
  } else if (stepAt < .12) stepAt = .12;
  // The extraction channel counts down with a heartbeat.
  if (p.extraction > 0 && p.status === 'alive') {
    extractTickAt -= dt;
    if (extractTickAt <= 0) { extractTickAt = .5; audio.tick(); }
  } else extractTickAt = 0;
  lastAttack = { attackSerial: p.attackSerial, cooldown: p.cooldown, swing: p.swing }; lastHp = p.hp; lastEs = p.es; lastBag = p.bag.length;
  lastHeals = p.heals; lastDodge = p.dodge;
}
let renderClock = -1, renderAccumulator = TARGET_FRAME_MS;
function frame(now: number) {
  const delta = Math.min((now - last) / 1000, .1); last = now;
  if (playing && !resultShown) {
    const p = getPlayer();
    if (!currentModal) {
      input.x = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
      input.y = Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup'));
      input.sprint = keys.has('shift'); input.interact = keys.has('e') || touchState.interact; input.dodge = keys.has(' ') || touchState.dodge; input.heal = keys.has('q') || input.heal;
      input.attack = mouseAttack || touchState.attack;
      if (coarsePointer() && p) {
        if (touchState.attack && aimPointer === null) {
          // Touch aim assist: snap toward the nearest target in range while the attack button is held.
          const target = nearestTarget(p, input.weapon === 'bow' ? 560 : 150);
          if (target) input.angle = Math.atan2(target.y - p.y, target.x - p.x);
          else if (input.x || input.y) input.angle = Math.atan2(input.y, input.x);
        } else if ((input.x || input.y) && aimPointer === null) input.angle = Math.atan2(input.y, input.x);
        // A touch reticle represents direction, except while a canvas drag is showing the finger itself.
        if (aimPointer === null) cursorWorld = { x: p.x + Math.cos(input.angle) * 150, y: p.y + Math.sin(input.angle) * 150 };
      }
    }
    if (mode === 'solo' && !paused && p) {
      accumulator += delta; p.input = { ...input }; while (accumulator >= 1 / 60) { stepGame(game, 1 / 60); accumulator -= 1 / 60; }
      syncCombatAudio(p, delta);
    }
    if (mode === 'online') { if (p) syncCombatAudio(p, delta); if (socket?.readyState === WebSocket.OPEN && now - sendAt > 50) { socket.send(JSON.stringify({ type: 'input', input })); sendAt = now; } }
    if (!keys.has('q')) input.heal = false;
    if (now - hudAt > 70) { updateHUD(); hudAt = now; }
  }
  const renderPlayer = playing ? getPlayer() : undefined;
  if (!renderPlayer) audio.setListener(1050, 895);
  audio.update(delta);
  if (renderPlayer && !cursorWorld) cursorWorld = { x: renderPlayer.x + Math.cos(input.angle) * 150, y: renderPlayer.y + Math.sin(input.angle) * 150 };
  // Time accumulation keeps Canvas output at ~60fps on 90/120/144Hz displays without the uneven 45fps cadence of skipping every other frame.
  renderAccumulator += renderClock < 0 ? TARGET_FRAME_MS : Math.min(now - renderClock, 100);
  renderClock = now;
  if (renderAccumulator >= TARGET_FRAME_MS - .5) {
    renderAccumulator = Math.max(0, renderAccumulator - TARGET_FRAME_MS);
    renderer.reducedMotion = save.reducedMotion;
    renderer.draw(game, playerId, !playing, mapOpen, now / 1000, renderPlayer && cursorWorld ? { ...cursorWorld, hot: input.attack || renderPlayer.swing > 0 } : undefined);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
if (staticHost) {
  $('online-mode').setAttribute('aria-disabled', 'true');
  $('online-mode').title = 'GitHub Pages版はソロ専用です。PvPvEにはCloudflare版が必要です。';
  setMode('solo');
} else {
  fetch('/api/health').then(r => r.ok ? r.json() : null).then(data => { onlineAvailable = (data as { multiplayer?: boolean } | null)?.multiplayer === true; if (mode === 'online' && !playing) setMode(mode); }).catch(() => { onlineAvailable = false; });
}
