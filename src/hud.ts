/** Resource presentation only; the underlying game rules stay in game.ts. */
export function resourcePercent(value: number, max: number) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, value / max * 100));
}

export function resourceOrbs() {
  return `<div class="vitals">
    <div class="resource-pod life-pod">
      <div class="resource-orb life-orb" id="life-orb" role="progressbar" aria-label="生命" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
        <div class="orb-glass"><i class="orb-liquid" id="hp-bar" style="height:100%"></i><span class="orb-reflection"></span></div>
        <div class="orb-reading"><small>生命</small><b id="hp-label">100</b><span id="hp-max">/ 100</span></div>
      </div>
      <div class="shield-gauge" title="エネルギーシールド"><span>ES</span><div class="bar"><i id="es-bar" style="width:0%"></i></div><b id="es-label">0</b></div>
    </div>
    <div class="resource-pod stamina-pod">
      <div class="resource-orb stamina-orb" id="stamina-orb" role="progressbar" aria-label="気力" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
        <div class="orb-glass"><i class="orb-liquid" id="st-bar" style="height:100%"></i><span class="orb-reflection"></span></div>
        <div class="orb-reading"><small>気力</small><b id="st-label">100</b><span id="st-max">/ 100</span></div>
      </div>
      <div class="stamina-caption">走る · 回避 · 攻撃</div>
    </div>
  </div>`;
}

/** A small original glass-and-brass healing flask rather than a flat outline symbol. */
export function healingFlask() {
  return `<svg class="flask-art" viewBox="0 0 40 64" aria-hidden="true"><defs>
    <linearGradient id="flask-glass" x1="0" x2="1"><stop stop-color="#101a1b"/><stop offset=".3" stop-color="#5e747365"/><stop offset=".55" stop-color="#182829"/><stop offset="1" stop-color="#52605a"/></linearGradient>
    <linearGradient id="flask-blood" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#ef683f"/><stop offset=".35" stop-color="#b22c25"/><stop offset="1" stop-color="#3e1015"/></linearGradient>
    <linearGradient id="flask-brass"><stop stop-color="#33291b"/><stop offset=".4" stop-color="#c2a875"/><stop offset=".6" stop-color="#ead5a0"/><stop offset="1" stop-color="#55412a"/></linearGradient>
  </defs>
  <path d="M15 8h10v15c0 6 9 10 9 21v9c0 6-5 8-14 8S6 59 6 53v-9c0-11 9-15 9-21Z" fill="url(#flask-glass)" stroke="#8c9d9377"/>
  <path d="M10 38c4 2 15 3 20 0 2 3 2 7 2 14 0 4-4 7-12 7S8 56 8 52c0-7 0-11 2-14Z" fill="url(#flask-blood)"/>
  <ellipse cx="20" cy="39" rx="10" ry="2" fill="#fbb18844"/>
  <path d="M13 5h14v8H13Z" fill="url(#flask-brass)" stroke="#796140"/>
  <path d="M16 2h8v4h-8Z" fill="#8f623e"/>
  <path d="M9 46h22v6H9Z" fill="url(#flask-brass)" opacity=".85"/>
  <path d="M20 43v12m-4-6h8" stroke="#ffe3ab" stroke-width="1.5"/>
  <path d="M12 34c-4 4-4 9-4 14m9-30v6" fill="none" stroke="#e6ecec9c" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`;
}
