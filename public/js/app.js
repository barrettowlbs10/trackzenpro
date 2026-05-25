const API = window.location.origin + '/api';
let TOKEN = localStorage.getItem('tztoken');
let USER = JSON.parse(localStorage.getItem('tzuser') || 'null');
let charts = {};

// ===== AUTH =====
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
  const password = document.getElementById('reg-password').value;
  const err = document.getElementById('reg-error');
  try {
    const r = await fetch(`${API}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password }) });
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

// ===== APP INIT =====
function startApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('register-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  const d = new Date();
  document.getElementById('top-date').textContent = d.toLocaleDateString('pt-BR');
  if (USER) {
    document.getElementById('user-name').textContent = USER.name;
    document.getElementById('user-av').textContent = USER.name.charAt(0).toUpperCase();
    document.getElementById('webhook-url') && (document.getElementById('webhook-url').textContent = `http://localhost:3000/api/webhook/${USER.id}`);
  }
  loadSummary('today');
  loadUserInfo();
}

window.onload = () => {
  if (TOKEN && USER) startApp();
};

// ===== NAVIGATION =====
const pageTitles = {
  resumo: ['Dashboard — Resumo', 'Visão geral de todas as plataformas'],
  meta: ['Meta Ads', 'Campanhas do Facebook e Instagram'],
  tiktok: ['TikTok Ads', 'Campanhas do TikTok'],
  google: ['Google Ads', 'Campanhas do Google'],
  utms: ['UTMs', 'Relatório e criação de links de rastreamento'],
  integracoes: ['Integrações', 'Conecte suas plataformas de vendas e anúncios'],
  pixels: ['Pixels', 'Gerencie seus pixels de rastreamento'],
  regras: ['Regras automáticas', 'Automatize suas campanhas com condições'],
  relatorios: ['Relatórios', 'Relatórios diários de performance'],
  notificacoes: ['Notificações', 'Configure seus alertas de venda'],
  assinatura: ['Assinatura', 'Gerencie seu plano e cobrança'],
  conta: ['Minha conta', 'Dados pessoais e configurações'],
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
  if (id === 'meta') loadPlatform('meta');
  if (id === 'tiktok') loadPlatform('tiktok');
  if (id === 'google') loadPlatform('google');
  if (id === 'relatorios') loadReports();
  if (id === 'regras') loadRules();
  if (id === 'pixels') loadPixels();
  if (id === 'utms') loadUtms();
  if (id === 'notificacoes') loadNotifications();
  if (id === 'assinatura') loadSubscription();
  if (id === 'conta') loadAccount();
}

function refreshPage() {
  const active = document.querySelector('.nav-item.active');
  if (active) active.click();
  else loadSummary('today');
}

function switchTab(platform, tab, el) {
  const bar = document.getElementById('tabs-' + platform);
  if (bar) bar.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
}

// ===== HELPERS =====
const R = v => v ? `R$ ${parseFloat(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'R$ 0,00';
const Pct = v => v ? `${parseFloat(v).toFixed(1)}%` : '0%';
const Rx = v => v ? `${parseFloat(v).toFixed(2)}x` : '0x';
const NA = v => (v == null || v === '' || isNaN(v)) ? 'N/A' : v;

function statusBadge(s) {
  if (s === 'active') return '<span class="b-ok">Ativa</span>';
  if (s === 'paused') return '<span class="b-pause">Pausada</span>';
  return '<span class="b-stop">Inativa</span>';
}

function roasColor(v) { return v >= 3 ? 'rg' : 'rl'; }

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

    // KPIs
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

    // Hourly charts
    const hrs = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0') + ':00');
    const fatData = d.hourly || Array(24).fill(0);
    const venData = fatData.map(v => Math.round(v / 97));

    mkChart('c-fat', 'line', hrs, [{
      data: fatData, borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.1)',
      borderWidth: 2, tension: 0.4, fill: true, pointRadius: 0
    }], { scales: { x: { grid: { display: false }, ticks: { font: { size: 8 }, color: '#4a5568', maxTicksLimit: 8 } }, y: { display: false } } });

    mkChart('c-ven', 'line', hrs, [{
      data: venData, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)',
      borderWidth: 2, tension: 0.4, fill: true, pointRadius: 0
    }], { scales: { x: { grid: { display: false }, ticks: { font: { size: 8 }, color: '#4a5568', maxTicksLimit: 8 } }, y: { display: false } } });

    // Sources donut
    const src = d.bySource || {};
    const srcLabels = Object.keys(src);
    const srcData = Object.values(src);
    const srcColors = ['#7c3aed', '#22c55e', '#f59e0b', '#3b82f6', '#6b7280', '#ef4444'];
    mkChart('c-src', 'doughnut', srcLabels, [{
      data: srcData, backgroundColor: srcColors.slice(0, srcLabels.length), borderWidth: 0, borderRadius: 2
    }], { cutout: '65%' });

    const total = srcData.reduce((a, b) => a + b, 0);
    document.getElementById('src-legend').innerHTML = srcLabels.map((l, i) =>
      `<div style="display:flex;justify-content:space-between;margin-bottom:2px"><span style="display:flex;align-items:center;gap:4px"><span style="width:7px;height:7px;background:${srcColors[i]};border-radius:2px;display:inline-block"></span>${l}</span><span style="color:#c4cad8">${total > 0 ? ((srcData[i] / total) * 100).toFixed(1) : 0}%</span></div>`
    ).join('');

    // Campaigns table
    const camps = await fetch(`${API}/campaigns?limit=5`, { headers: headers() }).then(r => r.json());
    document.getElementById('camp-count').textContent = camps.length + ' ativas';
    document.getElementById('camp-tbody').innerHTML = camps.slice(0, 6).map(c => `
      <tr>
        <td><div class="cn">${c.name}</div></td>
        <td style="color:${c.platform === 'meta' ? '#60a5fa' : c.platform === 'tiktok' ? '#fb923c' : '#4ade80'}">${c.platform}</td>
        <td>${statusBadge(c.status)}</td>
        <td>${c.sales_count || 0}</td>
        <td>${R(c.revenue)}</td>
        <td class="${roasColor(c.roas)}">${Rx(c.roas)}</td>
      </tr>`).join('');

    // Recent sales
    document.getElementById('recent-sales').innerHTML = (d.recent || []).slice(0, 6).map(s => `
      <div class="cv-item">
        <div style="display:flex;align-items:center;gap:7px">
          <div class="cv-ico"><i class="ti ti-shopping-cart"></i></div>
          <div><div style="font-size:11px;color:#e2e8f0">Purchase</div>
          <div style="font-size:9px;color:#6b7280">${s.platform || 'unknown'} · ${(s.campaign || '').substring(0, 20)}</div></div>
        </div>
        <div style="text-align:right"><div class="cv-val">${R(s.value)}</div>
        <div class="cv-t">${new Date(s.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div></div>
      </div>`).join('');

    // Notif badge
    if (d.unreadNotifs > 0) {
      const b = document.getElementById('notif-badge');
      b.textContent = d.unreadNotifs; b.style.display = 'inline';
    }
  } catch (e) { console.error('Erro summary:', e); }
}

// ===== PLATFORM =====
async function loadPlatform(platform) {
  try {
    const camps = await fetch(`${API}/campaigns?platform=${platform}`, { headers: headers() }).then(r => r.json());
    const total_rev = camps.reduce((s, c) => s + (c.revenue || 0), 0);
    const total_cnt = camps.reduce((s, c) => s + (c.sales_count || 0), 0);
    const total_spent = camps.reduce((s, c) => s + (c.spent || 0), 0);
    const avg_roas = total_spent > 0 ? total_rev / total_spent : 0;
    const avg_cpa = total_cnt > 0 ? total_spent / total_cnt : 0;

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

    const tbody = document.getElementById('tbody-' + platform);
    if (tbody) tbody.innerHTML = camps.map(c => {
      const profit = (c.revenue || 0) - (c.spent || 0);
      const margin = (c.revenue || 0) > 0 ? (profit / (c.revenue || 1)) * 100 : 0;
      return `<tr>
        <td><div class="cn">${c.name}</div><div class="cd">Criada em ${new Date(c.created_at).toLocaleDateString('pt-BR')}</div></td>
        <td>${statusBadge(c.status)}</td>
        ${platform === 'meta' ? `<td>${R(c.budget || 0)}</td>` : ''}
        <td>${(c.clicks || 0).toLocaleString('pt-BR')}</td>
        <td>${c.sales_count || 0}</td>
        <td class="${roasColor(c.cpa < 20 ? 3 : 1)}">${R(c.cpa)}</td>
        <td>${R(c.spent)}</td>
        <td>${R(c.revenue)}</td>
        ${platform === 'meta' ? `<td class="${profit >= 0 ? 'rg' : 'rl'}">${R(profit)}</td>` : ''}
        <td class="${roasColor(c.roas)}">${Rx(c.roas)}</td>
        ${platform === 'meta' ? `<td>${Pct(margin)}</td>` : ''}
      </tr>`;
    }).join('') || `<tr><td colspan="10" style="text-align:center;padding:24px;color:#4a5568">Nenhuma campanha cadastrada</td></tr>`;
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
        <td>${r.date}</td><td>${r.day}</td><td>${r.sales}</td>
        <td class="${r.cpa < 20 ? 'rg' : 'rl'}">${r.sales > 0 ? R(r.cpa) : 'N/A'}</td>
        <td>${R(r.spent)}</td><td>R$ 0,00</td><td>${R(r.revenue)}</td>
        <td class="${r.profit >= 0 ? 'rg' : 'rl'}">${R(r.profit)}</td>
        <td class="${r.roas >= 3 ? 'rg' : 'rl'}">${r.sales > 0 ? Rx(r.roas) : 'N/A'}</td>
        <td>${r.sales > 0 ? Pct(r.margin) : 'N/A'}</td>
        <td>${r.sales > 0 ? Pct(r.margin) : 'N/A'}</td>
        <td>N/A</td><td>N/A</td><td>0,00%</td>
      </tr>`).join('') +
      `<tr class="tr-total">
        <td>${rows.length} DIAS</td><td>—</td><td>${totSales}</td>
        <td class="${totSales > 0 && totSpent / totSales < 20 ? 'rg' : 'rl'}">${totSales > 0 ? R(totSpent / totSales) : 'N/A'}</td>
        <td>${R(totSpent)}</td><td>R$ 0,00</td><td>${R(totRev)}</td>
        <td class="${totProfit >= 0 ? 'rg' : 'rl'}">${R(totProfit)}</td>
        <td class="${totRev > 0 && totRev / totSpent >= 3 ? 'rg' : 'rl'}">${totRev > 0 && totSpent > 0 ? Rx(totRev / totSpent) : 'N/A'}</td>
        <td>${totRev > 0 ? Pct((totProfit / totRev) * 100) : 'N/A'}</td>
        <td>N/A</td><td>N/A</td><td>N/A</td><td>0,00%</td>
      </tr>`;
  } catch (e) { console.error('Erro reports:', e); }
}

function exportReport() {
  const rows = document.querySelectorAll('#tbody-reports tr');
  let csv = 'Data,Dia,Vendas,CPA,Gastos,Faturamento,Lucro,ROAS,Margem\n';
  rows.forEach(r => {
    const cells = r.querySelectorAll('td');
    csv += Array.from(cells).slice(0, 9).map(c => `"${c.textContent}"`).join(',') + '\n';
  });
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'relatorio-trackzen.csv';
  a.click();
}

// ===== RULES =====
async function loadRules() {
  try {
    const rules = await fetch(`${API}/rules`, { headers: headers() }).then(r => r.json());
    const metricLabel = { cpa: 'CPA', roas: 'ROAS', spent_no_sale: 'Gasto sem venda', spent: 'Gasto total' };
    const opLabel = { gt: 'Maior que', lt: 'Menor que', eq: 'Igual a' };
    const actionLabel = { pause_campaign: 'Pausar Campanhas', increase_budget: 'Aumentar Orçamento', decrease_budget: 'Diminuir Orçamento', notify: 'Apenas notificar' };
    const freqLabel = { '1h': 'A cada 1 hora', '2h': 'A cada 2 horas', '3h': 'A cada 3 horas', '6h': 'A cada 6 horas', '24h': 'Uma vez por dia' };

    document.getElementById('tbody-rules').innerHTML = rules.map(r => `
      <tr>
        <td><input type="checkbox"></td>
        <td>
          <label class="toggle">
            <input type="checkbox" ${r.status ? 'checked' : ''} onchange="toggleRule('${r.id}',this.checked)">
            <div class="toggle-track"></div><div class="toggle-thumb"></div>
          </label>
        </td>
        <td><div class="cn">${r.name}</div><div class="cd">Todos os produtos</div></td>
        <td>Campanhas ativas</td>
        <td><div class="cn">${actionLabel[r.action] || r.action}</div><div class="cd">Se ${metricLabel[r.condition_metric] || r.condition_metric} ${opLabel[r.condition_operator] || ''} R$ ${r.condition_value}</div></td>
        <td>${freqLabel[r.frequency] || r.frequency}<br><span class="cd">Período: Hoje</span></td>
        <td><button onclick="deleteRule('${r.id}')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px"><i class="ti ti-trash"></i></button></td>
      </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;padding:24px;color:#4a5568">Nenhuma regra criada</td></tr>';
  } catch (e) { console.error('Erro rules:', e); }
}

async function createRule() {
  const body = {
    name: document.getElementById('rule-name').value,
    platform: document.getElementById('rule-platform').value,
    condition_metric: document.getElementById('rule-metric').value,
    condition_operator: document.getElementById('rule-op').value,
    condition_value: parseFloat(document.getElementById('rule-value').value),
    action: document.getElementById('rule-action').value,
    action_value: parseFloat(document.getElementById('rule-action-val').value) || 0,
    frequency: document.getElementById('rule-freq').value,
  };
  if (!body.name || !body.condition_value) { alert('Preencha o nome e o valor da condição'); return; }
  await fetch(`${API}/rules`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  document.getElementById('rule-form').style.display = 'none';
  loadRules();
}

async function toggleRule(id, status) {
  await fetch(`${API}/rules/${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ status: status ? 1 : 0 }) });
}

async function deleteRule(id) {
  if (!confirm('Excluir esta regra?')) return;
  await fetch(`${API}/rules/${id}`, { method: 'DELETE', headers: headers() });
  loadRules();
}

// ===== PIXELS =====
async function loadPixels() {
  try {
    const pixels = await fetch(`${API}/pixels`, { headers: headers() }).then(r => r.json());
    document.getElementById('pixels-grid').innerHTML = pixels.map(px => `
      <div class="card">
        <div class="card-hd">
          <div class="card-ttl">
            <i class="ti ti-brand-${px.platform === 'meta' ? 'facebook' : px.platform === 'tiktok' ? 'tiktok' : 'google'}" style="color:${px.platform === 'meta' ? '#60a5fa' : px.platform === 'tiktok' ? '#fb923c' : '#4ade80'}"></i>
            ${px.platform.charAt(0).toUpperCase() + px.platform.slice(1)} Pixel
          </div>
          <span class="b-ok">Ativo</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;font-size:11px">
          <div style="display:flex;justify-content:space-between;color:#8892a4;padding:4px 0;border-bottom:1px solid #1e2130"><span>ID do pixel</span><span style="color:#a78bfa">${px.pixel_id}</span></div>
          <div style="display:flex;justify-content:space-between;color:#8892a4;padding:4px 0;border-bottom:1px solid #1e2130"><span>Score de qualidade</span><span style="color:#a78bfa">${px.quality_score}/100</span></div>
          <div style="display:flex;justify-content:space-between;color:#8892a4;padding:4px 0;border-bottom:1px solid #1e2130"><span>Eventos hoje</span><span style="color:#e2e8f0">${px.events_today.toLocaleString('pt-BR')}</span></div>
          <div style="display:flex;justify-content:space-between;color:#8892a4;padding:4px 0"><span>Correspondência</span><span style="color:${px.match_rate >= 80 ? '#22c55e' : '#f59e0b'}">${px.match_rate}%</span></div>
        </div>
      </div>`).join('') || '<div style="color:#4a5568;font-size:12px">Nenhum pixel cadastrado</div>';
  } catch (e) { console.error('Erro pixels:', e); }
}

async function addPixel() {
  const platform = document.getElementById('px-platform').value;
  const pixel_id = document.getElementById('px-id').value;
  const access_token = document.getElementById('px-token').value;
  if (!pixel_id) { alert('Informe o ID do pixel'); return; }
  await fetch(`${API}/pixels`, { method: 'POST', headers: headers(), body: JSON.stringify({ platform, pixel_id, access_token }) });
  document.getElementById('px-id').value = ''; document.getElementById('px-token').value = '';
  loadPixels();
}

// ===== UTMs =====
async function loadUtms() {
  try {
    const utms = await fetch(`${API}/utms`, { headers: headers() }).then(r => r.json());
    document.getElementById('tbody-utms').innerHTML = utms.map(u => {
      const conv_rate = u.clicks > 0 ? (u.conversions / u.clicks) * 100 : 0;
      return `<tr>
        <td><div class="cn">${u.utm_campaign || u.utm_source}</div><div class="cd">${u.utm_source} · ${u.utm_medium}</div></td>
        <td>${u.conversions}</td><td>N/A</td><td>N/A</td><td>N/A</td><td>N/A</td><td>N/A</td><td>N/A</td><td>N/A</td>
        <td>${u.clicks.toLocaleString('pt-BR')}</td><td class="rg">${u.conversions}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="11" style="text-align:center;padding:24px;color:#4a5568">Nenhum UTM criado</td></tr>';

    document.getElementById('utm-list').innerHTML = utms.slice(0, 5).map(u => `
      <div style="background:#1a1e2e;border:1px solid #2d3348;border-radius:7px;padding:10px;margin-bottom:7px">
        <div style="font-size:10px;color:#a78bfa;word-break:break-all;margin-bottom:5px">${u.full_url}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">
          <span style="background:#2d3348;color:#8892a4;font-size:9px;padding:2px 7px;border-radius:4px">${u.utm_source}</span>
          ${u.utm_medium ? `<span style="background:#2d3348;color:#8892a4;font-size:9px;padding:2px 7px;border-radius:4px">${u.utm_medium}</span>` : ''}
          ${u.utm_campaign ? `<span style="background:#2d3348;color:#8892a4;font-size:9px;padding:2px 7px;border-radius:4px">${u.utm_campaign}</span>` : ''}
          <span style="margin-left:auto;font-size:9px;color:#22c55e">${u.conversions} conversões</span>
          <button onclick="navigator.clipboard.writeText('${u.full_url}')" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:12px"><i class="ti ti-copy"></i></button>
        </div>
      </div>`).join('');
  } catch (e) { console.error('Erro utms:', e); }
}

async function createUtm() {
  const url = document.getElementById('utm-url').value;
  const utm_source = document.getElementById('utm-source').value;
  const utm_medium = document.getElementById('utm-medium').value;
  const utm_campaign = document.getElementById('utm-campaign').value;
  const utm_content = document.getElementById('utm-content').value;
  const utm_term = document.getElementById('utm-term').value;
  if (!url || !utm_source) { alert('URL e fonte são obrigatórios'); return; }
  const r = await fetch(`${API}/utms`, { method: 'POST', headers: headers(), body: JSON.stringify({ url, utm_source, utm_medium, utm_campaign, utm_content, utm_term }) });
  const d = await r.json();
  document.getElementById('utm-generated').textContent = d.full_url;
  document.getElementById('utm-result').style.display = 'block';
  loadUtms();
}

function copyUtm() {
  const url = document.getElementById('utm-generated').textContent;
  navigator.clipboard.writeText(url);
  alert('Link copiado!');
}

// ===== NOTIFICATIONS =====
async function loadNotifications() {
  try {
    const notifs = await fetch(`${API}/notifications`, { headers: headers() }).then(r => r.json());
    document.getElementById('notif-list').innerHTML = notifs.map(n => `
      <div class="cv-item">
        <div style="display:flex;align-items:flex-start;gap:8px">
          <div style="width:8px;height:8px;border-radius:50%;background:${n.type === 'success' ? '#22c55e' : n.type === 'warning' ? '#f59e0b' : '#ef4444'};margin-top:3px;flex-shrink:0"></div>
          <div>
            <div style="font-size:11px;color:#e2e8f0;font-weight:500">${n.title}</div>
            <div style="font-size:10px;color:#6b7280">${n.message}</div>
            <div style="font-size:9px;color:#4a5568;margin-top:2px">${new Date(n.created_at).toLocaleString('pt-BR')}</div>
          </div>
        </div>
      </div>`).join('') || '<div style="color:#4a5568;font-size:12px;padding:12px 0">Nenhuma notificação</div>';
  } catch (e) { console.error('Erro notifs:', e); }
}

async function markAllRead() {
  await fetch(`${API}/notifications/read-all`, { method: 'PATCH', headers: headers() });
  const b = document.getElementById('notif-badge');
  b.style.display = 'none';
  loadNotifications();
}

// ===== SUBSCRIPTION =====
async function loadSubscription() {
  try {
    const user = await fetch(`${API}/user`, { headers: headers() }).then(r => r.json());
    const pct = Math.round((user.events_used / user.events_limit) * 100);
    document.getElementById('plan-info').innerHTML = `${user.events_used.toLocaleString('pt-BR')} / ${user.events_limit.toLocaleString('pt-BR')} eventos usados`;
    document.getElementById('plan-desc').textContent = `Plano ${user.plan.charAt(0).toUpperCase() + user.plan.slice(1)} — R$ ${user.plan === 'pro' ? '97' : '0'},00 /mês`;
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
    document.getElementById('sidebar-plan').textContent = user.plan.charAt(0).toUpperCase() + user.plan.slice(1);
    const pct = Math.round((user.events_used / user.events_limit) * 100);
    document.getElementById('sidebar-events').textContent = `${user.events_used.toLocaleString('pt-BR')} / ${user.events_limit.toLocaleString('pt-BR')} eventos`;
    document.getElementById('sidebar-events-fill').style.width = pct + '%';
  } catch (e) { console.error('Erro account:', e); }
}

function saveAccount() { alert('Dados salvos!'); }

// ===== INTEGRATIONS =====
function showWebhookModal(platform) {
  const names = { meta: 'Meta Ads', tiktok: 'TikTok Ads', google: 'Google Ads', kwai: 'Kwai Ads' };
  document.getElementById('modal-title').textContent = `Integração — ${names[platform] || platform}`;
  const url = `http://localhost:3000/api/webhook/${USER?.id || 'SEU_ID'}`;
  document.getElementById('modal-url').textContent = url;
  document.getElementById('modal-webhook').style.display = 'flex';
}

function copyModalUrl() {
  navigator.clipboard.writeText(document.getElementById('modal-url').textContent);
  alert('URL copiada! Cole na sua plataforma de vendas.');
}

function copyWebhook() {
  const url = document.getElementById('webhook-url').textContent;
  navigator.clipboard.writeText(url);
  alert('URL copiada!');
}

// Auto refresh a cada 60s na página de resumo
setInterval(() => {
  if (document.querySelector('[data-page="resumo"].active')) loadSummary('today');
}, 60000);
