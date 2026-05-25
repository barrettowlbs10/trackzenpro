const API = window.location.origin + '/api';
let TOKEN = localStorage.getItem('tztoken');
let USER = JSON.parse(localStorage.getItem('tzuser') || 'null');
let charts = {};

function headers() { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` }; }

async function doLogin() {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const err = document.getElementById('login-error');
  try {
    const r = await fetch(`${API}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error; err.style.display = 'block'; return; }
    TOKEN = d.token; USER = d.user;
    localStorage.setItem('tztoken', TOKEN);
    localStorage.setItem('tzuser', JSON.stringify(USER));
    startApp();
  } catch { err.textContent = 'Servidor offline. Rode: npm start'; err.style.display = 'block'; }
}

async function doRegister() {
  const name = document.getElementById('reg-name').value;
  const email = document.getElementById('reg-email').value;
  const whatsapp = document.getElementById('reg-whatsapp').value;
  const password = document.getElementById('reg-password').value;
  const err = document.getElementById('reg-error');
  try {
    const r = await fetch(`${API}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password, whatsapp }) });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error; err.style.display = 'block'; return; }
    TOKEN = d.token; USER = d.user;
    localStorage.setItem('tztoken', TOKEN);
    localStorage.setItem('tzuser', JSON.stringify(USER));
    startApp();
  } catch { err.textContent = 'Erro ao conectar ao servidor'; err.style.display = 'block'; }
}

function showRegister() { document.getElementById('login-screen').style.display = 'none'; document.getElementById('register-screen').style.display = 'flex'; }
function showLogin() { document.getElementById('register-screen').style.display = 'none'; document.getElementById('login-screen').style.display = 'flex'; }

function logout() {
  localStorage.removeItem('tztoken'); localStorage.removeItem('tzuser');
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  TOKEN = null; USER = null;
}

function startApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('register-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('top-date').textContent = new Date().toLocaleDateString('pt-BR');
  if (USER) {
    document.getElementById('user-name').textContent = USER.name;
    document.getElementById('user-av').textContent = USER.name.charAt(0).toUpperCase();
    const wh = document.getElementById('webhook-url');
    if (wh) wh.textContent = `${window.location.origin}/api/webhook/${USER.id}`;
  }
  loadSummary('today');
  loadUserInfo();
  checkAdminAccess();
  setupWebSocket();
  setTimeout(requestPushPermission, 2000);
}

window.onload = () => { if (TOKEN && USER) startApp(); };

const pageTitles = {
  resumo: ['Dashboard — Resumo', 'Visão geral de todas as plataformas'],
  meta: ['Meta Ads', 'Campanhas do Facebook e Instagram'],
  tiktok: ['TikTok Ads', 'Campanhas do TikTok'],
  google: ['Google Ads', 'Campanhas do Google'],
  kwai: ['Kwai Ads', 'Campanhas do Kwai'],
  utms: ['UTMs', 'Relatório e criação de links de rastreamento'],
  integracoes: ['Integrações', 'Conecte suas plataformas de vendas e anúncios'],
  pixels: ['Pixels', 'Gerencie seus pixels de rastreamento'],
  regras: ['Regras automáticas', 'Automatize suas campanhas com condições'],
  relatorios: ['Relatórios', 'Relatórios diários de performance'],
  notificacoes: ['Notificações', 'Configure seus alertas de venda'],
  assinatura: ['Assinatura', 'Gerencie seu plano e cobrança'],
  conta: ['Minha conta', 'Dados pessoais e configurações'],
  admin: ['Painel Admin', 'Gerencie usuários e planos da plataforma'],
};

function navigate(id, el) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pg = document.getElementById('page-' + id);
  if (pg) pg.classList.add('active');
  if (pageTitles[id]) {
    document.getElementById('pg-title').textContent = pageTitles[id][0];
    document.getElementById('pg-sub').textContent = pageTitles[id][1];
  }
  if (['meta','tiktok','google','kwai'].includes(id)) loadPlatform(id);
  if (id === 'relatorios') loadReports();
  if (id === 'regras') loadRules();
  if (id === 'pixels') loadPixels();
  if (id === 'utms') loadUtms();
  if (id === 'notificacoes') loadNotifications();
  if (id === 'assinatura') loadSubscription();
  if (id === 'conta') loadAccount();
  if (id === 'admin') loadAdmin();
}

function refreshPage() {
  const active = document.querySelector('.nav-item.active');
  if (active) active.click(); else loadSummary('today');
}

function switchTab(platform, tab, el) {
  const bar = document.getElementById('tabs-' + platform);
  if (bar) bar.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
}

const R = v => v != null ? `R$ ${parseFloat(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'N/A';
const Pct = v => v != null && !isNaN(v) ? `${parseFloat(v).toFixed(1)}%` : 'N/A';
const Rx = v => v != null && !isNaN(v) && v > 0 ? `${parseFloat(v).toFixed(2)}x` : 'N/A';
const Num = v => v != null ? parseInt(v).toLocaleString('pt-BR') : '0';
const NA = v => (v == null || v === '' || isNaN(v) || v === 0) ? 'N/A' : v;

function statusBadge(s) {
  if (s === 'active') return '<span class="b-ok">Ativa</span>';
  if (s === 'paused') return '<span class="b-pause">Pausada</span>';
  return '<span class="b-stop">Inativa</span>';
}

function roasClass(v) { return parseFloat(v) >= 3 ? 'rg' : parseFloat(v) >= 2 ? '' : 'rl'; }

function mkChart(id, type, labels, datasets, opts = {}) {
  if (charts[id]) { charts[id].destroy(); }
  const ctx = document.getElementById(id);
  if (!ctx) return;
  charts[id] = new Chart(ctx, {
    type, data: { labels, datasets },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, ...opts }
  });
}

// ===== SUMMARY =====
async function loadSummary(period = 'today') {
  try {
    const r = await fetch(`${API}/dashboard/summary?period=${period}`, { headers: headers() });
    const d = await r.json();
    const kpis = [
      { lbl: 'Faturamento', val: R(d.revenue), delta: '+18,6%', up: true, ico: 'ti-currency-dollar', bg: '#14532d', ic: '#4ade80' },
      { lbl: 'Vendas', val: d.count, delta: '+23,4%', up: true, ico: 'ti-shopping-cart', bg: '#1e3a5f', ic: '#60a5fa' },
      { lbl: 'Ticket médio', val: R(d.ticket), delta: '-3,7%', up: false, ico: 'ti-currency-dollar', bg: '#2e1a4f', ic: '#a78bfa' },
      { lbl: 'ROAS', val: Rx(d.roas), delta: '+15,3%', up: true, ico: 'ti-target', bg: '#422006', ic: '#fb923c' },
      { lbl: 'CPA', val: R(d.cpa), delta: '-7,8%', up: false, ico: 'ti-chart-pie', bg: '#3b1f0a', ic: '#fbbf24' },
    ];
    document.getElementById('kpi-row').innerHTML = kpis.map(k => `
      <div class="kpi">
        <div class="kpi-ico" style="background:${k.bg}"><i class="ti ${k.ico}" style="color:${k.ic}"></i></div>
        <div><div class="kpi-lbl">${k.lbl}</div><div class="kpi-val">${k.val}</div>
        <div class="kpi-d ${k.up ? 'up' : 'down'}"><i class="ti ti-trending-${k.up ? 'up' : 'down'}" style="font-size:9px"></i> ${k.delta} vs ontem</div></div>
      </div>`).join('');
    const hrs = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0') + ':00');
    const fatData = d.hourly || Array(24).fill(0);
    const venData = fatData.map(v => Math.round(v / 97));
    mkChart('c-fat', 'line', hrs, [{ data: fatData, borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.1)', borderWidth: 2, tension: 0.4, fill: true, pointRadius: 0 }], { scales: { x: { grid: { display: false }, ticks: { font: { size: 8 }, color: '#4a5568', maxTicksLimit: 8 } }, y: { display: false } } });
    mkChart('c-ven', 'line', hrs, [{ data: venData, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', borderWidth: 2, tension: 0.4, fill: true, pointRadius: 0 }], { scales: { x: { grid: { display: false }, ticks: { font: { size: 8 }, color: '#4a5568', maxTicksLimit: 8 } }, y: { display: false } } });
    const src = d.bySource || {};
    const srcLabels = Object.keys(src);
    const srcData = Object.values(src);
    const srcColors = ['#7c3aed', '#22c55e', '#f59e0b', '#3b82f6', '#6b7280', '#ef4444'];
    mkChart('c-src', 'doughnut', srcLabels, [{ data: srcData, backgroundColor: srcColors.slice(0, srcLabels.length), borderWidth: 0 }], { cutout: '65%' });
    const total = srcData.reduce((a, b) => a + b, 0);
    document.getElementById('src-legend').innerHTML = srcLabels.map((l, i) =>
      `<div style="display:flex;justify-content:space-between;margin-bottom:2px"><span style="display:flex;align-items:center;gap:4px"><span style="width:7px;height:7px;background:${srcColors[i]};border-radius:2px;display:inline-block"></span>${l}</span><span style="color:#c4cad8">${total > 0 ? ((srcData[i] / total) * 100).toFixed(1) : 0}%</span></div>`
    ).join('');
    const camps = await fetch(`${API}/campaigns`, { headers: headers() }).then(r => r.json());
    document.getElementById('camp-count').textContent = camps.filter(c => c.status === 'active').length + ' ativas';
    document.getElementById('camp-tbody').innerHTML = camps.slice(0, 6).map(c => `
      <tr>
        <td><div class="cn">${c.name}</div></td>
        <td style="color:${c.platform === 'meta' ? '#60a5fa' : c.platform === 'tiktok' ? '#fb923c' : c.platform === 'kwai' ? '#a78bfa' : '#4ade80'}">${c.platform}</td>
        <td>${statusBadge(c.status)}</td>
        <td>${c.sales_count || 0}</td>
        <td>${R(c.revenue)}</td>
        <td class="${roasClass(c.roas)}">${Rx(c.roas)}</td>
      </tr>`).join('');
    document.getElementById('recent-sales').innerHTML = (d.recent || []).slice(0, 6).map(s => `
      <div class="cv-item">
        <div style="display:flex;align-items:center;gap:7px">
          <div class="cv-ico"><i class="ti ti-shopping-cart"></i></div>
          <div><div style="font-size:11px;color:#e2e8f0">Purchase</div>
          <div style="font-size:9px;color:#6b7280">${s.platform || 'unknown'} · ${(s.campaign || '').substring(0, 22)}</div></div>
        </div>
        <div style="text-align:right"><div class="cv-val">${R(s.value)}</div>
        <div class="cv-t">${new Date(s.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div></div>
      </div>`).join('');
    if (d.unreadNotifs > 0) { const b = document.getElementById('notif-badge'); b.textContent = d.unreadNotifs; b.style.display = 'inline'; }
  } catch (e) { console.error('Erro summary:', e); }
}

// ===== PLATFORM COM TABELA COMPLETA =====
async function loadPlatform(platform) {
  try {
    let camps;

    // Tentar puxar dados reais das APIs
    if (platform === 'meta') {
      const realData = await loadMetaRealData();
      if (realData && realData.length > 0) {
        camps = realData;
        const badge = document.getElementById('meta-realdata-badge');
        if (badge) badge.style.display = 'inline';
      } else {
        camps = await fetch(`${API}/campaigns?platform=${platform}`, { headers: headers() }).then(r => r.json());
        showMetaSetupIfNeeded();
      }
    } else if (platform === 'tiktok') {
      const realData = await loadTikTokRealData();
      if (realData && realData.length > 0) {
        camps = realData;
        const badge = document.getElementById('tiktok-realdata-badge');
        if (badge) badge.style.display = 'inline';
      } else {
        camps = await fetch(`${API}/campaigns?platform=${platform}`, { headers: headers() }).then(r => r.json());
        showTikTokSetupIfNeeded();
      }
    } else if (platform === 'kwai') {
      const realData = await loadKwaiRealData();
      if (realData && realData.length > 0) {
        camps = realData;
        const badge = document.getElementById('kwai-realdata-badge');
        if (badge) badge.style.display = 'inline';
      } else {
        camps = await fetch(`${API}/campaigns?platform=${platform}`, { headers: headers() }).then(r => r.json());
        showKwaiSetupIfNeeded();
      }
    } else {
      camps = await fetch(`${API}/campaigns?platform=${platform}`, { headers: headers() }).then(r => r.json());
    }
    const total_rev = camps.reduce((s, c) => s + (c.revenue || 0), 0);
    const total_cnt = camps.reduce((s, c) => s + (c.sales_count || 0), 0);
    const total_spent = camps.reduce((s, c) => s + (c.spent || 0), 0);
    const total_imp = camps.reduce((s, c) => s + (c.impressions || 0), 0);
    const total_clicks = camps.reduce((s, c) => s + (c.clicks || 0), 0);
    const avg_roas = total_spent > 0 ? total_rev / total_spent : 0;
    const avg_cpa = total_cnt > 0 ? total_spent / total_cnt : 0;
    const avg_cpm = total_imp > 0 ? (total_spent / total_imp) * 1000 : 0;
    const avg_cpc = total_clicks > 0 ? total_spent / total_clicks : 0;
    const avg_ctr = total_imp > 0 ? (total_clicks / total_imp) * 100 : 0;

    const kpiEl = document.getElementById('kpi-' + platform);
    if (kpiEl) kpiEl.innerHTML = [
      { lbl: 'Faturamento', val: R(total_rev), ico: 'ti-currency-dollar', bg: '#14532d', ic: '#4ade80' },
      { lbl: 'Vendas', val: total_cnt, ico: 'ti-shopping-cart', bg: '#1e3a5f', ic: '#60a5fa' },
      { lbl: 'ROAS médio', val: Rx(avg_roas), ico: 'ti-target', bg: '#422006', ic: '#fb923c' },
      { lbl: 'CPA médio', val: R(avg_cpa), ico: 'ti-chart-pie', bg: '#3b1f0a', ic: '#fbbf24' },
      { lbl: 'Gasto total', val: R(total_spent), ico: 'ti-cash', bg: '#2e1a4f', ic: '#a78bfa' },
    ].map(k => `
      <div class="kpi">
        <div class="kpi-ico" style="background:${k.bg}"><i class="ti ${k.ico}" style="color:${k.ic}"></i></div>
        <div><div class="kpi-lbl">${k.lbl}</div><div class="kpi-val">${k.val}</div></div>
      </div>`).join('');

    // Adicionar classe de scroll na tabela
    const tableWrap = tbody_el => {
      if (tbody_el) {
        const wrap = tbody_el.closest('.table-wrap');
        if (wrap) wrap.className = 'platform-table-wrap';
      }
    };
    const tbody = document.getElementById('tbody-' + platform);
    if (!tbody) return;
    tableWrap(tbody);

    if (camps.length === 0) {
      tbody.innerHTML = `<tr><td colspan="20" style="text-align:center;padding:32px;color:#4a5568"><i class="ti ti-speakerphone" style="font-size:24px;display:block;margin-bottom:8px"></i>Nenhuma campanha cadastrada</td></tr>`;
      return;
    }

    // Totais
    const total_profit = total_rev - total_spent;
    const total_margin = total_rev > 0 ? (total_profit / total_rev) * 100 : 0;
    const total_roi = total_spent > 0 ? (total_profit / total_spent) * 100 : 0;
    const total_budget = camps.reduce((s, c) => s + (c.budget || 0), 0);
    const total_conv = camps.reduce((s, c) => s + (c.conversas || 0), 0);

    // Atualizar cabeçalho da tabela com ícones info
    const tableEl = tbody.closest('table');
    if (tableEl) {
      const thead = tableEl.querySelector('thead tr');
      if (thead) {
        thead.innerHTML = `
          <th><input type="checkbox" style="width:13px;height:13px;accent-color:#7c3aed"></th>
          <th>STATUS</th>
          <th>CAMPANHA</th>
          <th>ORÇAMENTO</th>
          <th>CONVERSAS <i class="ti ti-info-circle" style="font-size:11px;color:#4a5568"></i></th>
          <th>CUSTO / CONVERSA <i class="ti ti-info-circle" style="font-size:11px;color:#4a5568"></i></th>
          <th>VENDAS</th>
          <th>CPA <i class="ti ti-info-circle" style="font-size:11px;color:#4a5568"></i></th>
          <th>GASTOS</th>
          <th>FATURAMENTO <i class="ti ti-info-circle" style="font-size:11px;color:#4a5568"></i></th>
          <th>LUCRO <i class="ti ti-info-circle" style="font-size:11px;color:#4a5568"></i></th>
          <th>ROAS <i class="ti ti-info-circle" style="font-size:11px;color:#4a5568"></i></th>
          <th>MARGEM <i class="ti ti-info-circle" style="font-size:11px;color:#4a5568"></i></th>
          <th>ROI <i class="ti ti-info-circle" style="font-size:11px;color:#4a5568"></i></th>
          <th>IC <i class="ti ti-info-circle" style="font-size:11px;color:#4a5568"></i></th>
          <th>CPI <i class="ti ti-info-circle" style="font-size:11px;color:#4a5568"></i></th>
          <th>CPC <i class="ti ti-info-circle" style="font-size:11px;color:#4a5568"></i></th>
          <th>CTR <i class="ti ti-info-circle" style="font-size:11px;color:#4a5568"></i></th>
          <th>CPM <i class="ti ti-info-circle" style="font-size:11px;color:#4a5568"></i></th>
          <th>IMPRESSÕES</th>
          <th>CLIQUES</th>
        `;
      }
    }

    setTimeout(() => {
      const wrap = document.querySelector('.platform-table-wrap');
      if (wrap) makeColumnsResizable(wrap);
    }, 100);

    tbody.innerHTML = camps.map(c => {
      const profit = (c.revenue || 0) - (c.spent || 0);
      const margin = (c.revenue || 0) > 0 ? (profit / (c.revenue || 1)) * 100 : 0;
      const roi = (c.spent || 0) > 0 ? (profit / c.spent) * 100 : 0;
      const cpm = (c.impressions || 0) > 0 ? ((c.spent || 0) / c.impressions) * 1000 : 0;
      const cpc = (c.clicks || 0) > 0 ? (c.spent || 0) / c.clicks : 0;
      const ctr = (c.impressions || 0) > 0 ? ((c.clicks || 0) / c.impressions) * 100 : 0;
      const cpi = (c.impressions || 0) > 0 ? (c.spent || 0) / c.impressions : 0;
      const conv_cost = (c.conversas || 0) > 0 ? (c.spent || 0) / c.conversas : 0;
      const ic = c.sales_count > 0 ? (c.revenue || 0) / c.sales_count : 0;
      return `<tr>
        <td class="col-fixed" style="min-width:70px">${statusBadge(c.status)}</td>
        <td class="col-fixed" style="min-width:160px;left:70px"><div class="cn">${c.name}</div><div class="cd">${new Date(c.created_at).toLocaleDateString('pt-BR')}</div></td>
        <td>${R(c.budget || 0)}</td>
        <td>${Num(c.conversas || 0)}</td>
        <td class="${conv_cost > 0 && conv_cost < 20 ? 'rg' : conv_cost > 0 ? 'rl' : ''}">${conv_cost > 0 ? R(conv_cost) : 'N/A'}</td>
        <td>${c.sales_count || 0}</td>
        <td class="${c.cpa > 0 && c.cpa < 20 ? 'rg' : c.cpa > 0 ? 'rl' : ''}">${c.cpa > 0 ? R(c.cpa) : 'N/A'}</td>
        <td>${R(c.spent || 0)}</td>
        <td>${R(c.revenue || 0)}</td>
        <td class="${profit >= 0 ? 'rg' : 'rl'}">${R(profit)}</td>
        <td class="${roasClass(c.roas)}">${Rx(c.roas)}</td>
        <td class="${margin >= 30 ? 'rg' : margin >= 0 ? '' : 'rl'}">${Pct(margin)}</td>
        <td class="${roi >= 50 ? 'rg' : roi >= 0 ? '' : 'rl'}">${Pct(roi)}</td>
        <td>${ic > 0 ? R(ic) : 'N/A'}</td>
        <td>${cpi > 0 ? 'R$ ' + cpi.toFixed(4) : 'N/A'}</td>
        <td>${cpc > 0 ? R(cpc) : 'N/A'}</td>
        <td>${ctr > 0 ? Pct(ctr) : 'N/A'}</td>
        <td>${cpm > 0 ? R(cpm) : 'N/A'}</td>
        <td>${Num(c.impressions || 0)}</td>
        <td>${Num(c.clicks || 0)}</td>
      </tr>`;
    }).join('') + `
    <tr class="tr-total">
      <td></td><td></td>
      <td style="font-weight:600;color:#e2e8f0">${camps.length} CAMPANHAS</td>
      <td>${R(total_budget)}</td>
      <td>${Num(total_conv)}</td>
      <td>—</td>
      <td>${total_cnt}</td>
      <td class="${avg_cpa > 0 && avg_cpa < 20 ? 'rg' : 'rl'}">${avg_cpa > 0 ? R(avg_cpa) : 'N/A'}</td>
      <td>${R(total_spent)}</td>
      <td>${R(total_rev)}</td>
      <td class="${total_profit >= 0 ? 'rg' : 'rl'}">${R(total_profit)}</td>
      <td class="${roasClass(avg_roas)}">${Rx(avg_roas)}</td>
      <td class="${total_margin >= 30 ? 'rg' : 'rl'}">${Pct(total_margin)}</td>
      <td class="${total_roi >= 50 ? 'rg' : 'rl'}">${Pct(total_roi)}</td>
      <td>—</td><td>—</td>
      <td>${avg_cpc > 0 ? R(avg_cpc) : 'N/A'}</td>
      <td>${avg_ctr > 0 ? Pct(avg_ctr) : 'N/A'}</td>
      <td>${avg_cpm > 0 ? R(avg_cpm) : 'N/A'}</td>
      <td>${Num(total_imp)}</td>
      <td>${Num(total_clicks)}</td>
    </tr>`;
  } catch (e) { console.error('Erro platform:', e); }
}

// ===== REPORTS =====
async function loadReports() {
  const period = document.getElementById('report-period')?.value || '7d';
  try {
    const rows = await fetch(`${API}/reports?period=${period}`, { headers: headers() }).then(r => r.json());
    const totRev = rows.reduce((s, r) => s + r.revenue, 0);
    const totSales = rows.reduce((s, r) => s + r.sales, 0);
    const totSpent = rows.reduce((s, r) => s + r.spent, 0);
    const totProfit = rows.reduce((s, r) => s + r.profit, 0);
    const body = document.getElementById('tbody-reports');
    if (body) body.innerHTML = rows.map(r => `
      <tr>
        <td>${r.date}</td><td style="text-transform:capitalize">${r.day}</td><td>${r.sales}</td>
        <td class="${r.sales > 0 && r.cpa < 20 ? 'rg' : 'rl'}">${r.sales > 0 ? R(r.cpa) : 'N/A'}</td>
        <td>${R(r.spent)}</td><td>R$ 0,00</td><td>${R(r.revenue)}</td>
        <td class="${r.profit >= 0 ? 'rg' : 'rl'}">${R(r.profit)}</td>
        <td class="${r.roas >= 3 ? 'rg' : 'rl'}">${r.sales > 0 ? Rx(r.roas) : 'N/A'}</td>
        <td>${r.sales > 0 ? Pct(r.margin) : 'N/A'}</td>
        <td>${r.sales > 0 ? Pct(r.margin) : 'N/A'}</td>
        <td>N/A</td><td>N/A</td><td>0,00%</td>
      </tr>`).join('') +
      `<tr class="tr-total">
        <td>${rows.length} DIAS</td><td>—</td><td>${totSales}</td>
        <td class="${totSales > 0 && totSpent/totSales < 20 ? 'rg' : 'rl'}">${totSales > 0 ? R(totSpent/totSales) : 'N/A'}</td>
        <td>${R(totSpent)}</td><td>R$ 0,00</td><td>${R(totRev)}</td>
        <td class="${totProfit >= 0 ? 'rg' : 'rl'}">${R(totProfit)}</td>
        <td class="${totRev > 0 && totRev/totSpent >= 3 ? 'rg' : 'rl'}">${totRev > 0 && totSpent > 0 ? Rx(totRev/totSpent) : 'N/A'}</td>
        <td>${totRev > 0 ? Pct((totProfit/totRev)*100) : 'N/A'}</td>
        <td>N/A</td><td>N/A</td><td>N/A</td><td>0,00%</td>
      </tr>`;
  } catch (e) { console.error('Erro reports:', e); }
}

function exportReport() {
  const rows = document.querySelectorAll('#tbody-reports tr');
  let csv = 'Data,Dia,Vendas,CPA,Gastos,Faturamento,Lucro,ROAS,Margem\n';
  rows.forEach(r => { const cells = r.querySelectorAll('td'); csv += Array.from(cells).slice(0,9).map(c=>`"${c.textContent}"`).join(',') + '\n'; });
  const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = 'relatorio-trackzen.csv'; a.click();
}

// ===== RULES =====
async function loadRules() {
  try {
    const rules = await fetch(`${API}/rules`, { headers: headers() }).then(r => r.json());
    const mL = { cpa:'CPA', roas:'ROAS', spent_no_sale:'Gasto sem venda', spent:'Gasto total' };
    const oL = { gt:'Maior que', lt:'Menor que', eq:'Igual a' };
    const aL = { pause_campaign:'Pausar Campanhas', increase_budget:'Aumentar Orçamento', decrease_budget:'Diminuir Orçamento', notify:'Apenas notificar' };
    const fL = { '1h':'A cada 1 hora', '2h':'A cada 2 horas', '3h':'A cada 3 horas', '6h':'A cada 6 horas', '24h':'Uma vez por dia' };
    document.getElementById('tbody-rules').innerHTML = rules.map(r => `
      <tr>
        <td><input type="checkbox"></td>
        <td><label class="toggle"><input type="checkbox" ${r.status ? 'checked' : ''} onchange="toggleRule('${r.id}',this.checked)"><div class="toggle-track"></div><div class="toggle-thumb"></div></label></td>
        <td><div class="cn">${r.name}</div><div class="cd">Todos os produtos</div></td>
        <td>Campanhas ativas</td>
        <td><div class="cn">${aL[r.action]||r.action}</div><div class="cd">Se ${mL[r.condition_metric]||r.condition_metric} ${oL[r.condition_operator]||''} R$ ${r.condition_value}</div></td>
        <td>${fL[r.frequency]||r.frequency}<br><span class="cd">Período: Hoje</span></td>
        <td><button onclick="deleteRule('${r.id}')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px"><i class="ti ti-trash"></i></button></td>
      </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;padding:24px;color:#4a5568">Nenhuma regra criada</td></tr>';
  } catch (e) { console.error('Erro rules:', e); }
}

async function createRule() {
  const body = { name:document.getElementById('rule-name').value, platform:document.getElementById('rule-platform').value, condition_metric:document.getElementById('rule-metric').value, condition_operator:document.getElementById('rule-op').value, condition_value:parseFloat(document.getElementById('rule-value').value), action:document.getElementById('rule-action').value, action_value:parseFloat(document.getElementById('rule-action-val').value)||0, frequency:document.getElementById('rule-freq').value };
  if (!body.name || !body.condition_value) { alert('Preencha o nome e o valor da condição'); return; }
  await fetch(`${API}/rules`, { method:'POST', headers:headers(), body:JSON.stringify(body) });
  document.getElementById('rule-form').style.display = 'none';
  loadRules();
}

async function toggleRule(id, status) { await fetch(`${API}/rules/${id}`, { method:'PATCH', headers:headers(), body:JSON.stringify({ status: status ? 1 : 0 }) }); }
async function deleteRule(id) { if (!confirm('Excluir esta regra?')) return; await fetch(`${API}/rules/${id}`, { method:'DELETE', headers:headers() }); loadRules(); }

// ===== PIXELS =====
async function loadPixels() {
  try {
    const pixels = await fetch(`${API}/pixels`, { headers: headers() }).then(r => r.json());
    document.getElementById('pixels-grid').innerHTML = pixels.map(px => `
      <div class="card">
        <div class="card-hd">
          <div class="card-ttl">
            <i class="ti ti-brand-${px.platform==='meta'?'facebook':px.platform==='tiktok'?'tiktok':'google'}" style="color:${px.platform==='meta'?'#60a5fa':px.platform==='tiktok'?'#fb923c':'#4ade80'}"></i>
            ${px.platform.charAt(0).toUpperCase()+px.platform.slice(1)} Pixel
          </div>
          <span class="${px.status==='active'?'b-ok':'b-pause'}">${px.status==='active'?'Ativo':'Inativo'}</span>
        </div>
        ${px.pixel_id ? `
        <div style="display:flex;flex-direction:column;gap:5px;font-size:11px">
          <div style="display:flex;justify-content:space-between;color:#8892a4;padding:4px 0;border-bottom:1px solid #1e2130"><span>ID do pixel</span><span style="color:#a78bfa">${px.pixel_id}</span></div>
          <div style="display:flex;justify-content:space-between;color:#8892a4;padding:4px 0;border-bottom:1px solid #1e2130"><span>Score de qualidade</span><span style="color:#a78bfa">${px.quality_score}/100</span></div>
          <div style="display:flex;justify-content:space-between;color:#8892a4;padding:4px 0;border-bottom:1px solid #1e2130"><span>Eventos hoje</span><span style="color:#e2e8f0">${px.events_today.toLocaleString('pt-BR')}</span></div>
          <div style="display:flex;justify-content:space-between;color:#8892a4;padding:4px 0"><span>Correspondência</span><span style="color:${px.match_rate>=80?'#22c55e':'#f59e0b'}">${px.match_rate}%</span></div>
        </div>
        <div style="display:flex;gap:6px;margin-top:10px">
          <button onclick="testPixel('${px.id}')" class="btn-upd" style="flex:1;justify-content:center"><i class="ti ti-player-play"></i> Testar disparo</button>
          <button onclick="deletePixel('${px.id}')" style="background:none;border:1px solid #3b1212;border-radius:6px;color:#ef4444;padding:5px 10px;cursor:pointer"><i class="ti ti-trash"></i></button>
        </div>` : `
        <div style="font-size:11px;color:#4a5568;padding:8px 0">Nenhum pixel configurado ainda</div>`}
      </div>`).join('') || '<div style="color:#4a5568;font-size:12px">Nenhum pixel cadastrado</div>';
  } catch (e) { console.error('Erro pixels:', e); }
}

async function testPixel(id) {
  const btn = event.target.closest('button');
  btn.textContent = 'Testando...'; btn.disabled = true;
  try {
    const r = await fetch(`${API}/pixels/${id}/test`, { method:'POST', headers:headers() });
    const d = await r.json();
    alert(d.success ? '✅ Disparo realizado com sucesso!' : `❌ Erro: ${d.error}`);
  } catch { alert('Erro ao testar pixel'); }
  btn.innerHTML = '<i class="ti ti-player-play"></i> Testar disparo'; btn.disabled = false;
}

async function deletePixel(id) {
  if (!confirm('Remover este pixel?')) return;
  await fetch(`${API}/pixels/${id}`, { method:'DELETE', headers:headers() });
  loadPixels();
}

async function addPixel() {
  const platform = document.getElementById('px-platform').value;
  const pixel_id = document.getElementById('px-id').value;
  const access_token = document.getElementById('px-token').value;
  const test_code = document.getElementById('px-testcode')?.value || '';
  if (!pixel_id) { alert('Informe o ID do pixel'); return; }
  if (!access_token) { alert('Informe o token de acesso'); return; }
  const r = await fetch(`${API}/pixels`, { method:'POST', headers:headers(), body:JSON.stringify({ platform, pixel_id, access_token, test_code }) });
  const d = await r.json();
  if (d.success) { alert('✅ Pixel salvo com sucesso!'); document.getElementById('px-id').value=''; document.getElementById('px-token').value=''; loadPixels(); }
}

// ===== UTMs =====
async function loadUtms() {
  try {
    const utms = await fetch(`${API}/utms`, { headers: headers() }).then(r => r.json());
    document.getElementById('tbody-utms').innerHTML = utms.map(u => `
      <tr>
        <td><div class="cn">${u.utm_campaign||u.utm_source}</div><div class="cd">${u.utm_source} · ${u.utm_medium}</div></td>
        <td>${u.conversions}</td><td>N/A</td><td>N/A</td><td>N/A</td><td>N/A</td><td>N/A</td><td>N/A</td><td>N/A</td>
        <td>${u.clicks.toLocaleString('pt-BR')}</td><td class="rg">${u.conversions}</td>
        <td><button onclick="deleteUtm('${u.id}')" style="background:none;border:none;color:#ef4444;cursor:pointer"><i class="ti ti-trash"></i></button></td>
      </tr>`).join('') || '<tr><td colspan="12" style="text-align:center;padding:24px;color:#4a5568">Nenhum UTM criado</td></tr>';
    document.getElementById('utm-list').innerHTML = utms.slice(0,5).map(u => `
      <div style="background:#1a1e2e;border:1px solid #2d3348;border-radius:7px;padding:10px;margin-bottom:7px">
        <div style="font-size:10px;color:#a78bfa;word-break:break-all;margin-bottom:5px">${u.full_url}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">
          <span style="background:#2d3348;color:#8892a4;font-size:9px;padding:2px 7px;border-radius:4px">${u.utm_source}</span>
          ${u.utm_medium?`<span style="background:#2d3348;color:#8892a4;font-size:9px;padding:2px 7px;border-radius:4px">${u.utm_medium}</span>`:''}
          ${u.utm_campaign?`<span style="background:#2d3348;color:#8892a4;font-size:9px;padding:2px 7px;border-radius:4px">${u.utm_campaign}</span>`:''}
          <span style="margin-left:auto;font-size:9px;color:#22c55e">${u.conversions} conversões</span>
          <button onclick="navigator.clipboard.writeText('${u.full_url}');alert('Copiado!')" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:12px"><i class="ti ti-copy"></i></button>
        </div>
      </div>`).join('');
  } catch (e) { console.error('Erro utms:', e); }
}

async function createUtm() {
  const url=document.getElementById('utm-url').value; const utm_source=document.getElementById('utm-source').value;
  const utm_medium=document.getElementById('utm-medium').value; const utm_campaign=document.getElementById('utm-campaign').value;
  const utm_content=document.getElementById('utm-content').value; const utm_term=document.getElementById('utm-term').value;
  if (!url||!utm_source) { alert('URL e fonte são obrigatórios'); return; }
  const r = await fetch(`${API}/utms`, { method:'POST', headers:headers(), body:JSON.stringify({ url,utm_source,utm_medium,utm_campaign,utm_content,utm_term }) });
  const d = await r.json();
  document.getElementById('utm-generated').textContent = d.full_url;
  document.getElementById('utm-result').style.display = 'block';
  loadUtms();
}

async function deleteUtm(id) { if(!confirm('Excluir este UTM?')) return; await fetch(`${API}/utms/${id}`,{method:'DELETE',headers:headers()}); loadUtms(); }
function copyUtm() { navigator.clipboard.writeText(document.getElementById('utm-generated').textContent); alert('Link copiado!'); }

// ===== NOTIFICATIONS =====
async function loadNotifications() {
  try {
    const notifs = await fetch(`${API}/notifications`, { headers: headers() }).then(r => r.json());
    document.getElementById('notif-list').innerHTML = notifs.map(n => `
      <div class="cv-item">
        <div style="display:flex;align-items:flex-start;gap:8px">
          <div style="width:8px;height:8px;border-radius:50%;background:${n.type==='success'?'#22c55e':n.type==='warning'?'#f59e0b':'#ef4444'};margin-top:3px;flex-shrink:0"></div>
          <div>
            <div style="font-size:11px;color:#e2e8f0;font-weight:500">${n.title}</div>
            <div style="font-size:10px;color:#6b7280">${n.message}</div>
            <div style="font-size:9px;color:#4a5568;margin-top:2px">${new Date(n.created_at).toLocaleString('pt-BR')}</div>
          </div>
        </div>
      </div>`).join('') || '<div style="color:#4a5568;font-size:12px;padding:12px 0">Nenhuma notificação</div>';

    // Load user Telegram settings
    const user = await fetch(`${API}/user`, { headers: headers() }).then(r => r.json());
    if (user) {
      document.getElementById('telegram-token-input').value = user.telegram_bot_token || '';
      document.getElementById('telegram-chat-id-input').value = user.telegram_chat_id || '';
    }
  } catch (e) { console.error('Erro notifs:', e); }
}

async function saveTelegramSettings() {
  const token = document.getElementById('telegram-token-input').value;
  const chat_id = document.getElementById('telegram-chat-id-input').value;
  try {
    const r = await fetch(`${API}/user`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ telegram_bot_token: token, telegram_chat_id: chat_id })
    });
    const d = await r.json();
    if (d.success) {
      alert('✅ Configurações do Telegram salvas com sucesso!');
    } else {
      alert('Erro ao salvar configurações do Telegram.');
    }
  } catch (e) {
    console.error('Erro ao salvar Telegram:', e);
    alert('Erro ao salvar configurações do Telegram.');
  }
}

async function markAllRead() {
  await fetch(`${API}/notifications/read-all`, { method:'PATCH', headers:headers() });
  document.getElementById('notif-badge').style.display = 'none';
  loadNotifications();
}

// ===== SUBSCRIPTION =====
async function loadSubscription() {
  try {
    const user = await fetch(`${API}/user`, { headers: headers() }).then(r => r.json());
    const pct = Math.round((user.events_used / user.events_limit) * 100);
    document.getElementById('plan-info').innerHTML = `${user.events_used.toLocaleString('pt-BR')} / ${user.events_limit.toLocaleString('pt-BR')} eventos usados — ${pct}%`;
    document.getElementById('plan-desc').textContent = `Plano ${user.plan.charAt(0).toUpperCase()+user.plan.slice(1)} — R$ ${user.plan==='pro'?'97':user.plan==='scale'?'197':'0'},00 /mês`;
    document.getElementById('plan-details').innerHTML = `
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #1e2130;color:#8892a4"><span>Webhooks configurados:</span><span>1/1</span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #1e2130;color:#8892a4"><span>Pixels utilizados:</span><span>2/5</span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #1e2130;color:#8892a4"><span>Eventos usados:</span><span>${user.events_used.toLocaleString('pt-BR')}</span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;color:#8892a4"><span>Limite de eventos:</span><span>${user.events_limit.toLocaleString('pt-BR')}</span></div>
      <div style="margin-top:10px"><div style="display:flex;justify-content:space-between;font-size:10px;color:#6b7280;margin-bottom:4px"><span>Eventos usados</span><span>${pct}%</span></div>
      <div style="height:6px;background:#1e2130;border-radius:3px"><div style="height:6px;background:#7c3aed;border-radius:3px;width:${pct}%"></div></div></div>`;
  } catch (e) { console.error('Erro subscription:', e); }
}

// ===== ACCOUNT =====
async function loadAccount() {
  try {
    const user = await fetch(`${API}/user`, { headers: headers() }).then(r => r.json());
    document.getElementById('acc-name').value = user.name;
    document.getElementById('acc-email').value = user.email;
    document.getElementById('sidebar-plan').textContent = user.plan.charAt(0).toUpperCase()+user.plan.slice(1);
    const pct = Math.round((user.events_used/user.events_limit)*100);
    document.getElementById('sidebar-events').textContent = `${user.events_used.toLocaleString('pt-BR')} / ${user.events_limit.toLocaleString('pt-BR')} eventos`;
    document.getElementById('sidebar-events-fill').style.width = pct + '%';
  } catch (e) { console.error('Erro account:', e); }
}

async function saveAccount() {
  const name = document.getElementById('acc-name').value;
  const password = document.getElementById('acc-password').value;
  const body = {};
  if (name) body.name = name;
  if (password) body.password = password;
  await fetch(`${API}/user`, { method:'PATCH', headers:headers(), body:JSON.stringify(body) });
  alert('✅ Dados salvos!');
}

// ===== INTEGRATIONS =====
function showWebhookModal(platform) {
  const names = { meta:'Meta Ads', tiktok:'TikTok Ads', google:'Google Ads', kwai:'Kwai Ads' };
  document.getElementById('modal-title').textContent = `Integração — ${names[platform]||platform}`;
  const url = `${window.location.origin}/api/webhook/${USER?.id||'SEU_ID'}`;
  document.getElementById('modal-url').textContent = url;
  document.getElementById('modal-webhook').style.display = 'flex';
}

function copyModalUrl() { navigator.clipboard.writeText(document.getElementById('modal-url').textContent); alert('URL copiada! Cole na sua plataforma de vendas.'); }
function copyWebhook() { const url = document.getElementById('webhook-url').textContent; navigator.clipboard.writeText(url); alert('URL copiada!'); }

// Auto refresh a cada 60s
setInterval(() => {
  if (document.querySelector('[data-page="resumo"].active')) loadSummary('today');
}, 60000);


// ===== COLUNAS REDIMENSIONAVEIS =====
function makeColumnsResizable(tableWrap) {
  const ths = tableWrap.querySelectorAll('thead th');
  ths.forEach((th, i) => {
    const old = th.querySelector('.col-resizer');
    if (old) old.remove();
    if (i === ths.length - 1) return;
    const resizer = document.createElement('div');
    resizer.className = 'col-resizer';
    resizer.title = 'Arraste para redimensionar';
    th.style.position = 'relative';
    th.appendChild(resizer);

    resizer.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = th.getBoundingClientRect().width;
      resizer.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMove(e) {
        const diff = e.clientX - startX;
        const newW = Math.max(50, startWidth + diff);
        th.style.minWidth = newW + 'px';
        th.style.maxWidth = newW + 'px';
        th.style.width = newW + 'px';
      }

      function onUp() {
        resizer.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

// ===== META ADS API FRONTEND =====
let metaConfigured = false;

async function checkMetaStatus() {
  try {
    const r = await fetch(`${API}/meta/status`, { headers: headers() });
    const d = await r.json();
    metaConfigured = d.configured;
    return d;
  } catch { return { configured: false }; }
}

async function loadMetaAdAccounts() {
  const token = document.getElementById('meta-token-input')?.value;
  if (!token) { alert('Cole o token de acesso primeiro!'); return; }
  const btn = document.getElementById('btn-load-accounts');
  if (btn) { btn.textContent = 'Carregando...'; btn.disabled = true; }
  try {
    const r = await fetch(`${API}/meta/ad-accounts?access_token=${encodeURIComponent(token)}`, { headers: headers() });
    const d = await r.json();
    if (!d.success) { alert('Erro: ' + d.error); return; }
    const sel = document.getElementById('meta-account-select');
    if (sel) {
      sel.innerHTML = '<option value="">Selecione a conta...</option>' +
        d.accounts.map(a => `<option value="${a.id}">${a.name} (${a.id})</option>`).join('');
      sel.style.display = 'block';
      document.getElementById('btn-save-meta').style.display = 'inline-flex';
    }
  } catch(e) { alert('Erro ao buscar contas: ' + e.message); }
  finally { if (btn) { btn.textContent = 'Buscar contas'; btn.disabled = false; } }
}

async function saveMetaAccount() {
  const token = document.getElementById('meta-token-input')?.value;
  const account = document.getElementById('meta-account-select')?.value;
  if (!token || !account) { alert('Selecione uma conta!'); return; }
  try {
    const r = await fetch(`${API}/meta/account`, { method:'POST', headers:headers(), body:JSON.stringify({ ad_account_id: account, access_token: token }) });
    const d = await r.json();
    if (d.success) {
      alert('✅ Conta Meta configurada! Clique em Atualizar para puxar os dados reais.');
      metaConfigured = true;
      document.getElementById('meta-setup-card')?.style && (document.getElementById('meta-setup-card').style.display = 'none');
      loadPlatform('meta');
    }
  } catch(e) { alert('Erro: ' + e.message); }
}

async function loadMetaRealData() {
  try {
    const r = await fetch(`${API}/meta/campaigns`, { headers: headers() });
    const d = await r.json();
    if (d.needsSetup) return null;
    if (!d.success) { console.log('Meta API erro:', d.error); return null; }
    return d.campaigns;
  } catch { return null; }
}

function showMetaSetupIfNeeded() {
  const card = document.getElementById('meta-setup-card');
  if (card) card.style.display = metaConfigured ? 'none' : 'block';
}

// ===== TIKTOK ADS API FRONTEND =====
let tiktokConfigured = false;

async function checkTikTokStatus() {
  try {
    const r = await fetch(`${API}/tiktok/status`, { headers: headers() });
    const d = await r.json();
    tiktokConfigured = d.configured;
    return d;
  } catch { return { configured: false }; }
}

async function loadTikTokAdAccounts() {
  const token = document.getElementById('tiktok-token-input')?.value;
  if (!token) { alert('Cole o token de acesso primeiro!'); return; }
  const btn = document.getElementById('btn-load-tiktok-accounts');
  if (btn) { btn.textContent = 'Carregando...'; btn.disabled = true; }
  try {
    const r = await fetch(`${API}/tiktok/ad-accounts?access_token=${encodeURIComponent(token)}`, { headers: headers() });
    const d = await r.json();
    if (!d.success) { alert('Erro: ' + d.error); return; }
    const sel = document.getElementById('tiktok-account-select');
    if (sel) {
      sel.innerHTML = '<option value="">Selecione a conta...</option>' +
        d.accounts.map(a => `<option value="${a.id}">${a.name} (${a.id})</option>`).join('');
      sel.style.display = 'block';
      document.getElementById('btn-save-tiktok').style.display = 'inline-flex';
    }
  } catch(e) { alert('Erro ao buscar contas: ' + e.message); }
  finally { if (btn) { btn.textContent = 'Buscar contas'; btn.disabled = false; } }
}

async function saveTikTokAccount() {
  const token = document.getElementById('tiktok-token-input')?.value;
  const account = document.getElementById('tiktok-account-select')?.value;
  if (!token || !account) { alert('Selecione uma conta!'); return; }
  try {
    const r = await fetch(`${API}/tiktok/account`, { method:'POST', headers:headers(), body:JSON.stringify({ advertiser_id: account, access_token: token }) });
    const d = await r.json();
    if (d.success) {
      alert('✅ Conta TikTok configurada! Clique em Atualizar para puxar os dados.');
      tiktokConfigured = true;
      document.getElementById('tiktok-setup-card')?.style && (document.getElementById('tiktok-setup-card').style.display = 'none');
      loadPlatform('tiktok');
    }
  } catch(e) { alert('Erro: ' + e.message); }
}

async function loadTikTokRealData() {
  try {
    const r = await fetch(`${API}/tiktok/campaigns`, { headers: headers() });
    const d = await r.json();
    if (d.needsSetup) return null;
    if (!d.success) { console.log('TikTok API erro:', d.error); return null; }
    return d.campaigns;
  } catch { return null; }
}

function showTikTokSetupIfNeeded() {
  const card = document.getElementById('tiktok-setup-card');
  if (card) card.style.display = tiktokConfigured ? 'none' : 'block';
}

// ===== KWAI ADS API FRONTEND =====
let kwaiConfigured = false;

async function checkKwaiStatus() {
  try {
    const r = await fetch(`${API}/kwai/status`, { headers: headers() });
    const d = await r.json();
    kwaiConfigured = d.configured;
    return d;
  } catch { return { configured: false }; }
}

async function loadKwaiAdAccounts() {
  const token = document.getElementById('kwai-token-input')?.value;
  if (!token) { alert('Cole o token de acesso primeiro!'); return; }
  const btn = document.getElementById('btn-load-kwai-accounts');
  if (btn) { btn.textContent = 'Carregando...'; btn.disabled = true; }
  try {
    const r = await fetch(`${API}/kwai/ad-accounts?access_token=${encodeURIComponent(token)}`, { headers: headers() });
    const d = await r.json();
    if (!d.success) { alert('Erro: ' + d.error); return; }
    const sel = document.getElementById('kwai-account-select');
    if (sel) {
      sel.innerHTML = '<option value="">Selecione a conta...</option>' +
        d.accounts.map(a => `<option value="${a.id}">${a.name} (${a.id})</option>`).join('');
      sel.style.display = 'block';
      document.getElementById('btn-save-kwai').style.display = 'inline-flex';
    }
  } catch(e) { alert('Erro ao buscar contas: ' + e.message); }
  finally { if (btn) { btn.textContent = 'Buscar contas'; btn.disabled = false; } }
}

async function saveKwaiAccount() {
  const token = document.getElementById('kwai-token-input')?.value;
  const account = document.getElementById('kwai-account-select')?.value;
  if (!token || !account) { alert('Selecione uma conta!'); return; }
  try {
    const r = await fetch(`${API}/kwai/account`, { method:'POST', headers:headers(), body:JSON.stringify({ advertiser_id: account, access_token: token }) });
    const d = await r.json();
    if (d.success) {
      alert('✅ Conta Kwai configurada! Clique em Atualizar para puxar os dados.');
      kwaiConfigured = true;
      document.getElementById('kwai-setup-card')?.style && (document.getElementById('kwai-setup-card').style.display = 'none');
      loadPlatform('kwai');
    }
  } catch(e) { alert('Erro: ' + e.message); }
}

async function loadKwaiRealData() {
  try {
    const r = await fetch(`${API}/kwai/campaigns`, { headers: headers() });
    const d = await r.json();
    if (d.needsSetup) return null;
    if (!d.success) { console.log('Kwai API erro:', d.error); return null; }
    return d.campaigns;
  } catch { return null; }
}

function showKwaiSetupIfNeeded() {
  const card = document.getElementById('kwai-setup-card');
  if (card) card.style.display = kwaiConfigured ? 'none' : 'block';
}

// ===== USER INFO & INTEGRATION STATUS =====
async function loadUserInfo() {
  try {
    const user = await fetch(`${API}/user`, { headers: headers() }).then(r => r.json());
    if (user) {
      document.getElementById('sidebar-plan').textContent = user.plan.charAt(0).toUpperCase()+user.plan.slice(1);
      const pct = Math.round((user.events_used / user.events_limit) * 100) || 0;
      document.getElementById('sidebar-events').textContent = `${user.events_used.toLocaleString('pt-BR')} / ${user.events_limit.toLocaleString('pt-BR')} eventos`;
      document.getElementById('sidebar-events-fill').style.width = pct + '%';
    }
    // Check integration statuses
    const meta = await checkMetaStatus();
    updateIntegrationStatus('meta', meta.configured);
    const tiktok = await checkTikTokStatus();
    updateIntegrationStatus('tiktok', tiktok.configured);
    const kwai = await checkKwaiStatus();
    updateIntegrationStatus('kwai', kwai.configured);
  } catch (e) { console.error('Erro loadUserInfo:', e); }
}

function updateIntegrationStatus(platform, connected) {
  const el = document.getElementById(`status-integ-${platform}`);
  if (el) {
    if (connected) {
      el.textContent = 'Conectado';
      el.className = 'integ-status status-ok';
    } else {
      el.textContent = 'Não conectado';
      el.className = 'integ-status status-warn';
    }
  }
}

// ===== ADMIN =====
let adminUsersCache = [];

async function loadAdmin() {
  try {
    const [statsR, usersR] = await Promise.all([
      fetch(`${API}/admin/stats`, { headers: headers() }),
      fetch(`${API}/admin/users`, { headers: headers() })
    ]);
    
    if (!statsR.ok) { console.log('Não é admin'); return; }
    
    const stats = await statsR.json();
    const users = await usersR.json();
    
    adminUsersCache = users;

    document.getElementById('admin-stats').innerHTML = [
      { lbl: 'Total usuários', val: stats.totalUsers, ico: 'ti-users', bg: '#1e3a5f', ic: '#60a5fa' },
      { lbl: 'Total vendas', val: stats.totalSales, ico: 'ti-shopping-cart', bg: '#14532d', ic: '#4ade80' },
      { lbl: 'Receita total', val: R(stats.totalRevenue), ico: 'ti-currency-dollar', bg: '#2e1a4f', ic: '#a78bfa' },
      { lbl: 'Planos Pro/Scale', val: (stats.planBreakdown.pro || 0) + (stats.planBreakdown.scale || 0), ico: 'ti-crown', bg: '#422006', ic: '#fb923c' },
    ].map(k => `
      <div class="kpi">
        <div class="kpi-ico" style="background:${k.bg}"><i class="ti ${k.ico}" style="color:${k.ic}"></i></div>
        <div><div class="kpi-lbl">${k.lbl}</div><div class="kpi-val">${k.val}</div></div>
      </div>`).join('');

    renderAdminUsers(users);

  } catch(e) { console.error('Erro admin:', e); }
}

function switchAdminTab(tab, el) {
  document.querySelectorAll('#tabs-admin .tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  
  document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');
  const target = document.getElementById('admin-tab-' + tab);
  if (target) target.style.display = 'block';
  
  if (tab === 'users') loadAdmin();
  if (tab === 'sales') loadAdminSales();
  if (tab === 'logs') loadAdminLogs();
  if (tab === 'stats') loadAdminStatsCharts();
}

function filterAdminUsers() {
  const query = document.getElementById('search-admin-users').value.toLowerCase();
  const planFilter = document.getElementById('filter-admin-plan').value;
  
  const filtered = adminUsersCache.filter(u => {
    const matchesQuery = u.name.toLowerCase().includes(query) || u.email.toLowerCase().includes(query);
    const matchesPlan = !planFilter || u.plan === planFilter;
    return matchesQuery && matchesPlan;
  });
  
  renderAdminUsers(filtered);
}

function renderAdminUsers(users) {
  document.getElementById('tbody-admin-users').innerHTML = users.map(u => {
    const lastAccessStr = u.last_access ? new Date(u.last_access).toLocaleString('pt-BR') : 'Sem registros';
    const statusAssinatura = u.subscription_status || 'active';
    const isBlocked = u.blocked === 1;
    
    return `
      <tr>
        <td>
          <div class="cn">${u.name}</div>
          <div class="cd">ID: ${u.id.substring(0,8)}</div>
        </td>
        <td style="color:#6b7280">${u.email}</td>
        <td>${u.whatsapp || 'N/A'}</td>
        <td style="color:#6b7280">${new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
        <td style="color:#6b7280">${lastAccessStr}</td>
        <td>
          <select onchange="updateUserPlan('${u.id}', this.value)" style="background:#1a1e2e;border:1px solid #2d3348;border-radius:5px;color:#e2e8f0;padding:3px 6px;font-size:10px">
            <option value="free" ${u.plan==='free'?'selected':''}>Free</option>
            <option value="pro" ${u.plan==='pro'?'selected':''}>Pro</option>
            <option value="scale" ${u.plan==='scale'?'selected':''}>Scale</option>
          </select>
        </td>
        <td>
          <select onchange="updateUserSubscriptionStatus('${u.id}', this.value)" style="background:#1a1e2e;border:1px solid #2d3348;border-radius:5px;color:${statusAssinatura === 'active' ? '#4ade80' : statusAssinatura === 'pending' ? '#fb923c' : '#f87171'};padding:3px 6px;font-size:10px">
            <option value="active" ${statusAssinatura === 'active' ? 'selected' : ''}>Ativa</option>
            <option value="pending" ${statusAssinatura === 'pending' ? 'selected' : ''}>Pendente</option>
            <option value="canceled" ${statusAssinatura === 'canceled' ? 'selected' : ''}>Cancelada</option>
          </select>
        </td>
        <td>${u.salesCount || 0}</td>
        <td class="rg">${R(u.salesRevenue || 0)}</td>
        <td>
          <div style="display:flex;gap:4px">
            <button onclick="viewUserDetails('${u.id}')" class="btn-upd" style="font-size:10px;padding:3px 8px" title="Ver detalhes completos"><i class="ti ti-eye"></i></button>
            <button onclick="toggleBlockUser('${u.id}', ${isBlocked ? 0 : 1})" class="btn-upd" style="font-size:10px;padding:3px 8px;color:${isBlocked ? '#4ade80' : '#f87171'}" title="${isBlocked ? 'Desbloquear acesso' : 'Bloquear acesso'}"><i class="ti ti-${isBlocked ? 'lock-open' : 'lock'}"></i></button>
            <button onclick="deleteUser('${u.id}')" style="background:none;border:1px solid #3b1212;border-radius:6px;color:#ef4444;padding:3px 7px;cursor:pointer;font-size:10px" title="Excluir cliente"><i class="ti ti-trash"></i></button>
          </div>
        </td>
      </tr>`;
  }).join('') || '<tr><td colspan="10" style="text-align:center;padding:24px;color:#4a5568">Nenhum cliente cadastrado</td></tr>';
}

async function toggleBlockUser(userId, blocked) {
  const r = await fetch(`${API}/admin/users/${userId}/status`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ blocked })
  });
  if (r.ok) {
    alert(`✅ Usuário ${blocked ? 'bloqueado' : 'desbloqueado'} com sucesso!`);
    loadAdmin();
  } else {
    alert('Erro ao alterar status de acesso do usuário.');
  }
}

async function updateUserPlan(userId, plan) {
  const limits = { free: 1000, pro: 100000, scale: 999999999 };
  await fetch(`${API}/admin/users/${userId}/plan`, {
    method: 'PATCH', headers: headers(),
    body: JSON.stringify({ plan, events_limit: limits[plan] })
  });
  alert(`✅ Plano atualizado para ${plan}!`);
}

async function updateUserSubscriptionStatus(userId, status) {
  const r = await fetch(`${API}/admin/users/${userId}/subscription`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ subscription_status: status })
  });
  if (r.ok) {
    alert('✅ Status da assinatura atualizado!');
    loadAdmin();
  }
}

async function deleteUser(userId) {
  if (!confirm('Tem certeza absoluta que deseja excluir este cliente do sistema? Esta ação irá remover todos os pixels, campanhas, regras e UTMs vinculados a ele, e NÃO poderá ser desfeita!')) return;
  
  const r = await fetch(`${API}/admin/users/${userId}`, {
    method: 'DELETE',
    headers: headers()
  });
  
  if (r.ok) {
    alert('✅ Cliente e todos os dados associados foram excluídos!');
    loadAdmin();
  } else {
    alert('Erro ao excluir usuário.');
  }
}

async function viewUserDetails(userId) {
  try {
    const r = await fetch(`${API}/admin/users/${userId}/details`, { headers: headers() });
    if (!r.ok) { alert('Erro ao carregar detalhes.'); return; }
    const data = await r.json();
    
    const u = data.user;
    const pixelsStr = data.pixels.map(p => `<span class="badge-purple" style="margin-right:4px; margin-bottom:4px; display:inline-block;">${p.platform.toUpperCase()} (${p.pixel_id || 'sem ID'})</span>`).join('') || '<span style="color:#6b7280">Nenhum pixel integrado</span>';
    const recentSalesStr = data.recentSales.map(s => `
      <div class="cv-item" style="padding:6px 0">
        <div style="font-size:11px;color:#e2e8f0">${new Date(s.created_at).toLocaleString('pt-BR')} · ${s.product}</div>
        <div style="text-align:right">
          <span style="color:#22c55e;font-weight:500">${R(s.value)}</span>
          <div style="font-size:9px;color:#6b7280">${s.platform} · UA: ${s.device || 'Desktop'}</div>
        </div>
      </div>
    `).join('') || '<div style="color:#6b7280;font-size:11px;padding:8px 0">Sem vendas recentes registradas</div>';
    
    document.getElementById('client-detail-content').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-size:10px;color:#6b7280;margin-bottom:2px">Nome Completo</div>
          <div style="font-size:12px;color:#fff;font-weight:500">${u.name}</div>
        </div>
        <div>
          <div style="font-size:10px;color:#6b7280;margin-bottom:2px">Email</div>
          <div style="font-size:12px;color:#fff">${u.email}</div>
        </div>
        <div>
          <div style="font-size:10px;color:#6b7280;margin-bottom:2px">WhatsApp</div>
          <div style="font-size:12px;color:#fff">${u.whatsapp || 'Não informado'}</div>
        </div>
        <div>
          <div style="font-size:10px;color:#6b7280;margin-bottom:2px">Data de Cadastro</div>
          <div style="font-size:12px;color:#fff">${new Date(u.created_at).toLocaleString('pt-BR')}</div>
        </div>
        <div>
          <div style="font-size:10px;color:#6b7280;margin-bottom:2px">Faturamento Trackeado</div>
          <div style="font-size:12px;color:#22c55e;font-weight:600">${R(data.revenue)}</div>
        </div>
        <div>
          <div style="font-size:10px;color:#6b7280;margin-bottom:2px">Total de Vendas</div>
          <div style="font-size:12px;color:#fff;font-weight:600">${data.salesCount} vendas</div>
        </div>
      </div>
      
      <div style="border-top:1px solid #1e2130;padding-top:12px">
        <div style="font-weight:500;color:#e2e8f0;font-size:12px;margin-bottom:6px">Pixels Integrados</div>
        <div>${pixelsStr}</div>
      </div>
      
      <div style="border-top:1px solid #1e2130;padding-top:12px;flex:1;display:flex;flex-direction:column;min-height:0">
        <div style="font-weight:500;color:#e2e8f0;font-size:12px;margin-bottom:6px">Vendas Recentes do Cliente</div>
        <div style="overflow-y:auto;flex:1;padding-right:4px">${recentSalesStr}</div>
      </div>
    `;
    
    document.getElementById('modal-client-details').style.display = 'flex';
  } catch(e) {
    console.error(e);
    alert('Erro ao carregar detalhes.');
  }
}

async function loadAdminSales() {
  try {
    const r = await fetch(`${API}/admin/sales`, { headers: headers() });
    if (!r.ok) return;
    const sales = await r.json();
    
    document.getElementById('tbody-admin-sales').innerHTML = sales.map(s => {
      const date = new Date(s.created_at).toLocaleString('pt-BR');
      return `
        <tr>
          <td>${date}</td>
          <td>
            <div class="cn">${s.userName}</div>
            <div class="cd">${s.userEmail}</div>
          </td>
          <td style="color:${s.platform === 'meta' ? '#60a5fa' : s.platform === 'tiktok' ? '#fb923c' : '#4ade80'}">${s.platform}</td>
          <td>${s.product}</td>
          <td class="rg">${R(s.value)}</td>
          <td><span class="${s.status === 'approved' ? 'b-ok' : 'b-stop'}">${s.status === 'approved' ? 'Aprovada' : s.status}</span></td>
          <td>
            <div class="cn">${s.utm_campaign || 'N/A'}</div>
            <div class="cd">source: ${s.utm_source || 'direto'} | medium: ${s.utm_medium || 'N/A'}</div>
          </td>
          <td>${s.device || 'Desktop'}</td>
          <td>${s.geo || 'Brasil / São Paulo'}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="9" style="text-align:center;padding:24px;color:#4a5568">Nenhuma venda encontrada na plataforma</td></tr>';
  } catch(e) {
    console.error(e);
  }
}

async function loadAdminLogs() {
  try {
    const r = await fetch(`${API}/admin/logs`, { headers: headers() });
    if (!r.ok) return;
    const logs = await r.json();
    
    document.getElementById('tbody-admin-logs').innerHTML = logs.map(l => {
      const date = new Date(l.created_at).toLocaleString('pt-BR');
      let badgeColor = '#7c3aed';
      if (l.type === 'sale') badgeColor = '#22c55e';
      if (l.type === 'block_toggle') badgeColor = '#ef4444';
      if (l.type === 'delete_user') badgeColor = '#7f1d1d';
      
      return `
        <tr>
          <td>${date}</td>
          <td><span style="background:${badgeColor}22;color:${badgeColor};font-size:9px;padding:2px 8px;border-radius:4px">${l.type.toUpperCase()}</span></td>
          <td style="font-weight:500;color:#e2e8f0">${l.message}</td>
          <td style="color:#6b7280;font-size:10px">${l.details || ''}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="4" style="text-align:center;padding:24px;color:#4a5568">Nenhum log de atividades registrado</td></tr>';
  } catch(e) {
    console.error(e);
  }
}

async function loadAdminStatsCharts() {
  try {
    const r = await fetch(`${API}/admin/users`, { headers: headers() });
    if (!r.ok) return;
    const users = await r.json();
    
    const plans = { free: 0, pro: 0, scale: 0 };
    users.forEach(u => {
      if (plans[u.plan] !== undefined) plans[u.plan]++;
    });
    
    mkChart('c-admin-plans', 'doughnut', ['Free', 'Pro', 'Scale'], [
      { data: [plans.free, plans.pro, plans.scale], backgroundColor: ['#6b7280', '#7c3aed', '#22c55e'], borderWidth: 0 }
    ], { cutout: '60%' });
    
    const registrationsByDate = {};
    users.forEach(u => {
      const date = new Date(u.created_at).toLocaleDateString('pt-BR');
      registrationsByDate[date] = (registrationsByDate[date] || 0) + 1;
    });
    const regDates = Object.keys(registrationsByDate).sort().slice(-7);
    const regCounts = regDates.map(d => registrationsByDate[d]);
    
    mkChart('c-admin-sales-trend', 'bar', regDates, [
      { label: 'Novos Clientes', data: regCounts, backgroundColor: '#7c3aed', borderRadius: 4 }
    ], { scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } });
    
  } catch(e) {
    console.error(e);
  }
}

// Mostrar/esconder admin na sidebar baseado no papel do usuário
function checkAdminAccess() {
  setTimeout(() => {
    try {
      const storedUser = JSON.parse(localStorage.getItem('tzuser') || '{}');
      const adminEmails = ['demo@trackzenpro.com'];
      const nav = document.getElementById('nav-admin');
      if (!nav) { console.log('nav-admin element not found'); return; }
      if (adminEmails.includes(storedUser.email)) {
        nav.removeAttribute('style');
        nav.style.cssText = 'display:flex !important;align-items:center;gap:8px;padding:7px 12px;border-radius:7px;cursor:pointer;color:#a78bfa;font-size:12px;margin:1px 6px;';
        console.log('Admin shown for:', storedUser.email);
      }
    } catch(e) { console.error('Admin check error:', e); }
  }, 800);
}

// ===== PWA PUSH NOTIFICATIONS =====
async function registerPush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await fetch(`${API}/push/subscribe`, { method:'POST', headers:headers(), body:JSON.stringify({ subscription: existing }) });
      return;
    }
  } catch(e) { console.log('Push:', e); }
}

async function requestPushPermission() {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    await registerPush();
  } catch(e) { console.log('Permission:', e); }
}

function notifyNewSale(value, platform, campaign) {
  if (typeof showLocalNotification === 'function') {
    showLocalNotification(
      '🛒 Venda aprovada!',
      `R$ ${parseFloat(value).toFixed(2)} — ${platform} · ${campaign}`,
      { url: '/' }
    );
  }
}

// ===== WEBSOCKETS REAL-TIME =====
let socket = null;
function setupWebSocket() {
  if (socket) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}?token=${TOKEN}`;
  
  socket = new WebSocket(wsUrl);
  
  socket.onopen = () => {
    console.log('Conexão WebSocket ativa!');
  };
  
  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'new_sale') {
        playNotificationSound();
        notifyNewSale(data.sale.value, data.sale.platform, data.sale.campaign);
        
        if (document.querySelector('[data-page="resumo"].active')) {
          loadSummary('today');
        }
        
        if (document.querySelector('[data-page="admin"].active')) {
          const activeTab = document.querySelector('#tabs-admin .tab.active');
          if (activeTab) {
            const tabName = activeTab.textContent.toLowerCase();
            if (tabName.includes('vendas')) loadAdminSales();
            else if (tabName.includes('clientes')) loadAdmin();
            else if (tabName.includes('logs')) loadAdminLogs();
          }
        }
      }
    } catch (e) {
      console.error('Erro WebSocket mensagem:', e);
    }
  };
  
  socket.onclose = () => {
    console.log('Conexão WebSocket fechada. Reconectando...');
    socket = null;
    setTimeout(setupWebSocket, 5000);
  };
}

// ===== SOUND SYNTHESIS =====
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const playTone = (freq, duration, delay) => {
      setTimeout(() => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      }, delay * 1000);
    };
    playTone(1500, 0.15, 0);
    playTone(1900, 0.25, 0.08);
  } catch (e) {
    console.log('Erro ao tocar som:', e);
  }
}