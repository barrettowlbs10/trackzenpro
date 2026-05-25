const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const https = require('https');
const url = require('url');
const WebSocket = require('ws');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'trackzenpro-secret-2024';
const DB_PATH = path.join(__dirname, 'data/db.json');

// Global WebSocket server reference
let wss = null;

// Helper: UA parse to detect device
function getDeviceFromUA(ua) {
  if (!ua) return 'Desktop';
  const uac = ua.toLowerCase();
  if (uac.includes('mobi') || uac.includes('android') || uac.includes('iphone') || uac.includes('ipad')) return 'Mobile';
  return 'Desktop';
}

// Helper: Mock geo location from IP
function getGeoFromIP(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.')) {
    return 'Brasil / São Paulo';
  }
  const locations = [
    'Brasil / Rio de Janeiro', 'Brasil / Belo Horizonte', 'Brasil / Curitiba', 
    'Brasil / Porto Alegre', 'Brasil / Salvador', 'Brasil / Brasília', 
    'Brasil / Fortaleza', 'Brasil / Recife', 'Brasil / Goiânia'
  ];
  const hash = ip.split('.').reduce((acc, part) => acc + parseInt(part || 0), 0);
  return locations[hash % locations.length];
}

// Helper: Log administrative/system activity
function logAdminActivity(db, type, message, details) {
  if (!db.admin_logs) db.admin_logs = [];
  db.admin_logs.unshift({
    id: uuidv4(),
    type,
    message,
    details: details || '',
    created_at: new Date().toISOString()
  });
  if (db.admin_logs.length > 500) db.admin_logs = db.admin_logs.slice(0, 500);
}

// Helper: Broadcast sale via WebSockets
function broadcastSale(sale, user) {
  if (!wss) return;
  const msg = JSON.stringify({
    type: 'new_sale',
    sale: {
      id: sale.id,
      value: sale.value,
      product: sale.product,
      platform: sale.platform,
      campaign: sale.campaign,
      created_at: sale.created_at,
      device: sale.device,
      geo: sale.geo,
      status: sale.status,
      payment_method: sale.payment_method
    },
    user: {
      name: user.name,
      email: user.email
    }
  });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      if (client.userId === user.id) {
        client.send(msg);
      } else if (client.role === 'admin' || client.userEmail === 'demo@trackzenpro.com') {
        client.send(msg);
      }
    }
  });
}

// Helper: Simulate mobile / web push notification
function sendPushNotification(user, sale) {
  if (!user.push_subscriptions || user.push_subscriptions.length === 0) return;
  console.log(`[PUSH] Notificação enviada para ${user.name}: R$ ${sale.value.toFixed(2)} - ${sale.product}`);
}

// Helper: Send Telegram notification message
async function sendTelegramNotification(user, sale) {
  if (!user.telegram_chat_id || !user.telegram_bot_token) return;
  
  const text = `🛒 *Venda aprovada!*\n\n*Produto:* ${sale.product || 'Produto'}\n*Valor:* R$ ${sale.value.toFixed(2)}\n*Plataforma:* ${sale.platform.toUpperCase()}\n*Campanha:* ${sale.campaign || 'N/A'}\n*Horário:* ${new Date(sale.created_at).toLocaleString('pt-BR')}`;
  
  const token = user.telegram_bot_token;
  const chat_id = user.telegram_chat_id;
  const path = `/bot${token}/sendMessage?chat_id=${chat_id}&text=${encodeURIComponent(text)}&parse_mode=Markdown`;
  
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.telegram.org',
      path,
      method: 'GET'
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ success: res.statusCode === 200, body: JSON.parse(data) });
        } catch {
          resolve({ success: false });
        }
      });
    });
    req.on('error', (e) => {
      console.error('Telegram notification error:', e.message);
      resolve({ success: false, error: e.message });
    });
    req.end();
  });
}

// Helper: Fetch TikTok campaigns
async function fetchTikTokCampaigns(accessToken, advertiserId) {
  try {
    return await new Promise((resolve) => {
      const options = {
        hostname: 'business-api.tiktok.com',
        path: `/open_api/v1.3/campaign/get/?advertiser_id=${advertiserId}&fields=["campaign_id","campaign_name","status","budget","budget_mode"]`,
        method: 'GET',
        headers: {
          'Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.code !== 0) resolve({ success: false, error: parsed.message });
            else resolve({ success: true, data: parsed.data?.list || [] });
          } catch { resolve({ success: false, error: 'Resposta inválida' }); }
        });
      });
      req.on('error', e => resolve({ success: false, error: e.message }));
      req.end();
    });
  } catch (e) { return { success: false, error: e.message }; }
}

// Helper: Fetch Kwai campaigns
async function fetchKwaiCampaigns(accessToken, advertiserId) {
  try {
    return await new Promise((resolve) => {
      const options = {
        hostname: 'open.kuaishou.com',
        path: `/openapi/v1/ad_account/campaign/list?advertiser_id=${advertiserId}`,
        method: 'GET',
        headers: {
          'Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.code !== 0) resolve({ success: false, error: parsed.message });
            else resolve({ success: true, data: parsed.data?.list || [] });
          } catch { resolve({ success: false, error: 'Resposta inválida' }); }
        });
      });
      req.on('error', e => resolve({ success: false, error: e.message }));
      req.end();
    });
  } catch (e) { return { success: false, error: e.message }; }
}

// Helper: Run automated rules checker
function runAutomatedRules() {
  console.log('[RULES] Iniciando verificação de regras automáticas...');
  const db = loadDB();
  
  if (!db.rules || db.rules.length === 0) {
    console.log('[RULES] Nenhuma regra ativa no sistema.');
    return;
  }

  const activeRules = db.rules.filter(r => r.status === 1);
  console.log(`[RULES] Processando ${activeRules.length} regras ativas...`);

  for (const rule of activeRules) {
    try {
      const user = db.users.find(u => u.id === rule.user_id);
      if (!user) continue;

      const userCampaigns = db.campaigns.filter(c => c.user_id === user.id && c.platform === rule.platform);
      
      for (const camp of userCampaigns) {
        const sales = db.sales.filter(s => s.user_id === user.id && s.campaign === camp.name && s.status === 'approved');
        const revenue = sales.reduce((s, v) => s + v.value, 0);
        const count = sales.length;
        const spent = camp.spent || 0;
        const roas = spent > 0 ? revenue / spent : 0;
        const cpa = count > 0 ? spent / count : 0;

        let triggered = false;
        let metricVal = 0;

        if (rule.condition_metric === 'cpa') {
          metricVal = cpa;
          triggered = rule.condition_operator === 'gt' ? cpa > rule.condition_value : cpa < rule.condition_value;
        } else if (rule.condition_metric === 'roas') {
          metricVal = roas;
          triggered = rule.condition_operator === 'gt' ? roas > rule.condition_value : roas < rule.condition_value;
        } else if (rule.condition_metric === 'spent_no_sale') {
          metricVal = spent;
          triggered = count === 0 && (rule.condition_operator === 'gt' ? spent > rule.condition_value : spent < rule.condition_value);
        } else if (rule.condition_metric === 'spent') {
          metricVal = spent;
          triggered = rule.condition_operator === 'gt' ? spent > rule.condition_value : spent < rule.condition_value;
        }

        if (triggered) {
          console.log(`[RULES] Regra "${rule.name}" disparada na campanha "${camp.name}" (Métrica: ${rule.condition_metric} = ${metricVal})`);
          
          let actionText = '';
          if (rule.action === 'pause_campaign') {
            camp.status = 'paused';
            actionText = 'pausada automaticamente';
          } else if (rule.action === 'increase_budget') {
            camp.budget = (camp.budget || 0) * (1 + (rule.action_value || 0) / 100);
            actionText = `orçamento aumentado em ${rule.action_value}%`;
          } else if (rule.action === 'decrease_budget') {
            camp.budget = (camp.budget || 0) * (1 - (rule.action_value || 0) / 100);
            actionText = `orçamento diminuído em ${rule.action_value}%`;
          } else {
            actionText = 'alerta disparado';
          }

          db.notifications.unshift({
            id: uuidv4(),
            user_id: user.id,
            title: `🤖 Regra disparada: ${rule.name}`,
            message: `A campanha "${camp.name}" foi ${actionText}. Condição: ${rule.condition_metric} (${metricVal.toFixed(2)}) ${rule.condition_operator === 'gt' ? '>' : '<'} ${rule.condition_value}`,
            type: 'warning',
            read: 0,
            created_at: new Date().toISOString()
          });

          logAdminActivity(db, 'rule_trigger', `Regra "${rule.name}" executada`, `Campanha: ${camp.name} | Usuário: ${user.name}`);
        }
      }
    } catch (e) {
      console.error(`[RULES] Erro ao processar regra ${rule.name}:`, e.message);
    }
  }

  saveDB(db);
}

// ===== BANCO DE DADOS =====
function loadDB() {
  if (!fs.existsSync(DB_PATH)) return { users:[], sales:[], campaigns:[], pixels:[], rules:[], utms:[], notifications:[], events_log:[] };
  try { return JSON.parse(fs.readFileSync(DB_PATH,'utf8')); }
  catch { return { users:[], sales:[], campaigns:[], pixels:[], rules:[], utms:[], notifications:[], events_log:[] }; }
}
function saveDB(data) {
  fs.mkdirSync(path.dirname(DB_PATH),{recursive:true});
  fs.writeFileSync(DB_PATH, JSON.stringify(data,null,2));
}

// ===== META CAPI =====
async function fireMetaCAPI(pixel, saleData) {
  if (!pixel || !pixel.access_token || !pixel.pixel_id) return { success: false, error: 'Pixel ou token não configurado' };
  try {
    const eventId = uuidv4();
    const payload = {
      data: [{
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: 'website',
        user_data: {
          em: saleData.email ? hashData(saleData.email) : undefined,
          ph: saleData.phone ? hashData(saleData.phone) : undefined,
          client_ip_address: saleData.ip || '127.0.0.1',
          client_user_agent: saleData.user_agent || 'TrackZenPro/1.0',
          fbc: saleData.fbc || undefined,
          fbp: saleData.fbp || undefined,
        },
        custom_data: {
          currency: 'BRL',
          value: parseFloat(saleData.value || 0),
          content_name: saleData.product || 'Produto',
          content_type: 'product',
          order_id: saleData.id || eventId,
        },
        event_source_url: saleData.source_url || 'https://seusite.com',
      }],
      test_event_code: pixel.test_code || undefined,
    };

    const postData = JSON.stringify(payload);
    const options = {
      hostname: 'graph.facebook.com',
      path: `/v18.0/${pixel.pixel_id}/events?access_token=${pixel.access_token}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    };

    return await new Promise((resolve) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ success: !parsed.error, response: parsed, event_id: eventId });
          } catch { resolve({ success: false, error: 'Resposta inválida da Meta' }); }
        });
      });
      req.on('error', e => resolve({ success: false, error: e.message }));
      req.write(postData);
      req.end();
    });
  } catch(e) { return { success: false, error: e.message }; }
}

// ===== TIKTOK EVENTS API =====
async function fireTikTokAPI(pixel, saleData) {
  if (!pixel || !pixel.access_token || !pixel.pixel_id) return { success: false, error: 'Pixel ou token não configurado' };
  try {
    const eventId = uuidv4();
    const payload = {
      pixel_code: pixel.pixel_id,
      event: 'CompletePayment',
      event_id: eventId,
      timestamp: new Date().toISOString(),
      context: {
        user_agent: saleData.user_agent || 'TrackZenPro/1.0',
        ip: saleData.ip || '127.0.0.1',
        page: { url: saleData.source_url || 'https://seusite.com' },
        user: {
          email: saleData.email ? hashData(saleData.email) : undefined,
          phone_number: saleData.phone ? hashData(saleData.phone) : undefined,
        },
      },
      properties: {
        currency: 'BRL',
        value: parseFloat(saleData.value || 0),
        content_type: 'product',
        contents: [{ content_id: saleData.product_id || '001', content_name: saleData.product || 'Produto', quantity: 1, price: parseFloat(saleData.value || 0) }],
        order_id: saleData.id || eventId,
      },
    };

    const postData = JSON.stringify({ event_source: 'web', data: [payload] });
    const options = {
      hostname: 'business-api.tiktok.com',
      path: '/open_api/v1.3/event/track/',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': pixel.access_token, 'Content-Length': Buffer.byteLength(postData) },
    };

    return await new Promise((resolve) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ success: parsed.code === 0, response: parsed, event_id: eventId });
          } catch { resolve({ success: false, error: 'Resposta inválida do TikTok' }); }
        });
      });
      req.on('error', e => resolve({ success: false, error: e.message }));
      req.write(postData);
      req.end();
    });
  } catch(e) { return { success: false, error: e.message }; }
}


// ===== META ADS API - PUXAR DADOS REAIS =====
async function fetchMetaAdData(accessToken, adAccountId) {
  try {
    const fields = 'campaign_name,impressions,clicks,spend,cpm,cpc,ctr,reach,frequency,actions,cost_per_action_type';
    const datePreset = 'today';
    const url = `https://graph.facebook.com/v18.0/${adAccountId}/insights?fields=${fields}&date_preset=${datePreset}&level=campaign&access_token=${accessToken}`;
    
    return await new Promise((resolve) => {
      const options = {
        hostname: 'graph.facebook.com',
        path: `/v18.0/${adAccountId}/insights?fields=${fields}&date_preset=${datePreset}&level=campaign&access_token=${accessToken}`,
        method: 'GET',
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) resolve({ success: false, error: parsed.error.message });
            else resolve({ success: true, data: parsed.data || [] });
          } catch { resolve({ success: false, error: 'Resposta inválida' }); }
        });
      });
      req.on('error', e => resolve({ success: false, error: e.message }));
      req.end();
    });
  } catch(e) { return { success: false, error: e.message }; }
}

async function fetchMetaCampaigns(accessToken, adAccountId) {
  try {
    const fields = 'id,name,status,budget_remaining,daily_budget,lifetime_budget,objective';
    return await new Promise((resolve) => {
      const options = {
        hostname: 'graph.facebook.com',
        path: `/v18.0/${adAccountId}/campaigns?fields=${fields}&access_token=${accessToken}`,
        method: 'GET',
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) resolve({ success: false, error: parsed.error.message });
            else resolve({ success: true, data: parsed.data || [] });
          } catch { resolve({ success: false, error: 'Resposta inválida' }); }
        });
      });
      req.on('error', e => resolve({ success: false, error: e.message }));
      req.end();
    });
  } catch(e) { return { success: false, error: e.message }; }
}

function hashData(data) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(data.trim().toLowerCase()).digest('hex');
}

// ===== LOG DE EVENTOS =====
function logEvent(db, userId, platform, pixelId, eventType, saleId, result) {
  if (!db.events_log) db.events_log = [];
  db.events_log.unshift({
    id: uuidv4(), user_id: userId, platform, pixel_id: pixelId,
    event_type: eventType, sale_id: saleId,
    success: result.success, response: JSON.stringify(result.response || result.error || ''),
    created_at: new Date().toISOString()
  });
  if (db.events_log.length > 500) db.events_log = db.events_log.slice(0, 500);
}

// ===== SEED DEMO =====
function seedDemo() {
  const db = loadDB();
  if (!db.events_log) { db.events_log = []; saveDB(db); }
  if (db.users.find(u => u.email === 'demo@trackzenpro.com')) return;
  const userId = 'demo-user-001';
  db.users.push({ 
    id: userId, 
    name: 'Usuário Demo', 
    email: 'demo@trackzenpro.com', 
    password: bcrypt.hashSync('demo123', 10), 
    plan: 'pro', 
    role: 'admin', 
    whatsapp: '+55 (11) 99999-9999',
    subscription_status: 'active',
    blocked: 0,
    last_access: new Date().toISOString(),
    events_used: 0, 
    events_limit: 100000, 
    created_at: new Date().toISOString() 
  });
  saveDB(db);
  console.log('✅ Usuário demo criado (sem dados fictícios)!');
}

seedDemo();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));


// ===== SEGURANÇA E MULTI-USUÁRIO =====

// Rate limiting simples
const requestCounts = {};
function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  if (!requestCounts[ip]) requestCounts[ip] = { count: 0, resetAt: now + 60000 };
  if (now > requestCounts[ip].resetAt) { requestCounts[ip] = { count: 0, resetAt: now + 60000 }; }
  requestCounts[ip].count++;
  if (requestCounts[ip].count > 100) return res.status(429).json({ error: 'Muitas requisições. Tente em 1 minuto.' });
  next();
}
app.use('/api', rateLimit);

// Verificar limite de eventos do plano
function checkEventLimit(req, res, next) {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user?.id);
  if (!user) return next();
  const limits = { free: 1000, pro: 100000, scale: Infinity };
  const limit = limits[user.plan] || 1000;
  if ((user.events_used || 0) >= limit) {
    return res.status(403).json({ 
      error: 'Limite de eventos atingido', 
      code: 'EVENT_LIMIT_REACHED',
      plan: user.plan,
      used: user.events_used,
      limit 
    });
  }
  next();
}

// Verificar acesso a features por plano
function checkPlan(requiredPlan) {
  return (req, res, next) => {
    const db = loadDB();
    const user = db.users.find(u => u.id === req.user?.id);
    if (!user) return res.status(401).json({ error: 'Não autorizado' });
    const planLevels = { free: 0, pro: 1, scale: 2 };
    const userLevel = planLevels[user.plan] || 0;
    const requiredLevel = planLevels[requiredPlan] || 0;
    if (userLevel < requiredLevel) {
      return res.status(403).json({ error: `Recurso disponível apenas no plano ${requiredPlan}`, code: 'UPGRADE_REQUIRED', requiredPlan });
    }
    next();
  };
}

function auth(req,res,next){
  const token=req.headers.authorization?.split(' ')[1];
  if(!token) return res.status(401).json({error:'Não autorizado'});
  try {
    req.user=jwt.verify(token,JWT_SECRET);
    
    // Verificação de bloqueio e atualização de último acesso
    const db = loadDB();
    const user = db.users.find(u => u.id === req.user.id);
    if (user) {
      if (user.blocked === 1) {
        return res.status(403).json({ error: 'Acesso bloqueado pelo administrador.' });
      }
      user.last_access = new Date().toISOString();
      saveDB(db);
    }
    next();
  }
  catch{res.status(401).json({error:'Token inválido'});}
}

// ===== AUTH =====
app.post('/api/login',(req,res)=>{
  const{email,password}=req.body; const db=loadDB();
  const user=db.users.find(u=>u.email===email);
  if(!user||!bcrypt.compareSync(password,user.password)) return res.status(401).json({error:'Email ou senha incorretos'});
  if(user.blocked === 1) return res.status(403).json({error:'Acesso bloqueado pelo administrador.'});
  user.last_access = new Date().toISOString();
  saveDB(db);
  const token=jwt.sign({id:user.id,email:user.email,name:user.name},JWT_SECRET,{expiresIn:'7d'});
  res.json({token,user:{id:user.id,name:user.name,email:user.email,plan:user.plan}});
});

app.post('/api/register',(req,res)=>{
  const{name,email,password,whatsapp}=req.body;
  if(!name||!email||!password) return res.status(400).json({error:'Preencha todos os campos'});
  const db=loadDB();
  if(db.users.find(u=>u.email===email)) return res.status(400).json({error:'Email já cadastrado'});
  const id=uuidv4();
  db.users.push({
    id,
    name,
    email,
    whatsapp: whatsapp || '',
    password: bcrypt.hashSync(password,10),
    plan: 'free',
    subscription_status: 'active',
    blocked: 0,
    last_access: new Date().toISOString(),
    events_used: 0,
    events_limit: 1000,
    created_at: new Date().toISOString()
  });
  saveDB(db);
  const token=jwt.sign({id,email,name},JWT_SECRET,{expiresIn:'7d'});
  res.json({token,user:{id,name,email,plan:'free'}});
});

// ===== DASHBOARD =====
app.get('/api/dashboard/summary',auth,(req,res)=>{
  const db=loadDB(); const uid=req.user.id;
  const today=new Date(); today.setHours(0,0,0,0);
  const sales=db.sales.filter(s=>s.user_id===uid&&s.status==='approved'&&new Date(s.created_at)>=today);
  const revenue=sales.reduce((s,v)=>s+v.value,0);
  const count=sales.length; const ticket=count>0?revenue/count:0;
  const totalSpent=db.campaigns.filter(c=>c.user_id===uid).reduce((s,c)=>s+(c.spent||0),0);
  const roas=totalSpent>0?revenue/totalSpent:0; const cpa=count>0?totalSpent/count:0;
  const bySource={}; sales.forEach(s=>{const k=s.utm_source||'direct';bySource[k]=(bySource[k]||0)+s.value;});
  const hourly=Array(24).fill(0); sales.forEach(s=>{const h=new Date(s.created_at).getHours();hourly[h]+=s.value;});
  const recent=db.sales.filter(s=>s.user_id===uid).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,10);
  const unreadNotifs=db.notifications.filter(n=>n.user_id===uid&&!n.read).length;
  res.json({revenue,count,ticket,roas,cpa,spent:totalSpent,bySource,hourly,recent,unreadNotifs});
});

// ===== CAMPAIGNS =====
app.get('/api/campaigns',auth,(req,res)=>{
  const db=loadDB(); const{platform}=req.query;
  let camps=db.campaigns.filter(c=>c.user_id===req.user.id);
  if(platform&&platform!=='all') camps=camps.filter(c=>c.platform===platform);
  const result=camps.map(c=>{
    const sales=db.sales.filter(s=>s.user_id===req.user.id&&s.campaign===c.name&&s.status==='approved');
    const revenue=sales.reduce((s,v)=>s+v.value,0); const count=sales.length;
    const roas=(c.spent||0)>0?revenue/c.spent:0; const cpa=count>0?c.spent/count:0;
    return{...c,revenue,sales_count:count,roas,cpa};
  });
  res.json(result);
});

app.post('/api/campaigns',auth,(req,res)=>{
  const db=loadDB(); const{name,platform,budget}=req.body;
  const camp={id:uuidv4(),user_id:req.user.id,name,platform,status:'active',budget:budget||0,spent:0,impressions:0,clicks:0,created_at:new Date().toISOString()};
  db.campaigns.push(camp); saveDB(db); res.json({success:true,id:camp.id});
});

// ===== SALES =====
app.get('/api/sales',auth,(req,res)=>{
  const db=loadDB(); const{period='today',limit=50}=req.query;
  let since=new Date();
  if(period==='today') since.setHours(0,0,0,0);
  else if(period==='7d') since.setDate(since.getDate()-7);
  else if(period==='30d') since.setDate(since.getDate()-30);
  res.json(db.sales.filter(s=>s.user_id===req.user.id&&new Date(s.created_at)>=since).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,parseInt(limit)));
});

// ===== WEBHOOK UNIVERSAL =====
app.post('/api/webhook/:userId', async (req,res)=>{
  const db=loadDB(); const{userId}=req.params;
  const user=db.users.find(u=>u.id===userId);
  if(!user) return res.status(404).json({error:'Usuário não encontrado'});

  const data=req.body;
  const value=parseFloat(data.value||data.amount||data.price||data.total||0);
  const status=data.status||data.payment_status||data.situation||'approved';
  const normalizedStatus = ['approved','completed','paid','complete','aprovado','pago'].includes(status.toLowerCase()) ? 'approved' : status;

  const device = data.device || getDeviceFromUA(req.headers['user-agent']);
  const geo = data.country && data.city ? `${data.country} / ${data.city}` : getGeoFromIP(req.ip);

  const sale={
    id:uuidv4(), user_id:userId,
    platform: data.platform||data.utm_source||'unknown',
    campaign: data.campaign||data.utm_campaign||'',
    utm_source: data.utm_source||'',
    utm_medium: data.utm_medium||'',
    utm_campaign: data.utm_campaign||'',
    utm_content: data.utm_content||'',
    value, status: normalizedStatus,
    payment_method: data.payment_method||data.payment_type||data.pagamento||'unknown',
    product: data.product||data.product_name||data.nome_produto||'',
    email: data.email||data.buyer_email||'',
    phone: data.phone||data.buyer_phone||'',
    ip: req.ip||'',
    user_agent: req.headers['user-agent']||'',
    device,
    geo,
    raw: JSON.stringify(data),
    created_at: new Date().toISOString()
  };

  db.sales.push(sale);
  if(user) user.events_used=(user.events_used||0)+1;

  // Transmitir via websocket para o cliente e administradores
  broadcastSale(sale, user);
  sendPushNotification(user, sale);
  logAdminActivity(db, 'sale', `Venda de R$ ${value.toFixed(2)} - ${sale.product}`, `Cliente: ${user.name} (${user.email}) | Plataforma: ${sale.platform}`);

  // Notificação
  if(normalizedStatus === 'approved'){
    // Disparar notificação Telegram
    sendTelegramNotification(user, sale);

    db.notifications.unshift({
      id:uuidv4(), user_id:userId,
      title:`🛒 Venda aprovada — R$${value.toFixed(2)}`,
      message:`${sale.product||'Produto'} · via ${sale.utm_source||'webhook'} · ${sale.payment_method}`,
      type:'success', read:0, created_at:new Date().toISOString()
    });

    // Disparar para Meta CAPI
    const metaPixels = db.pixels.filter(p=>p.user_id===userId&&p.platform==='meta'&&p.pixel_id&&p.access_token&&p.status==='active');
    for(const px of metaPixels){
      const result = await fireMetaCAPI(px, sale);
      logEvent(db, userId, 'meta', px.pixel_id, 'Purchase', sale.id, result);
      if(result.success){
        px.events_today = (px.events_today||0)+1;
        console.log(`✅ Meta CAPI disparado — Pixel ${px.pixel_id} — R$${value}`);
      } else {
        console.log(`❌ Meta CAPI erro — ${result.error}`);
      }
    }

    // Disparar para TikTok
    const tiktokPixels = db.pixels.filter(p=>p.user_id===userId&&p.platform==='tiktok'&&p.pixel_id&&p.access_token&&p.status==='active');
    for(const px of tiktokPixels){
      const result = await fireTikTokAPI(px, sale);
      logEvent(db, userId, 'tiktok', px.pixel_id, 'CompletePayment', sale.id, result);
      if(result.success){
        px.events_today = (px.events_today||0)+1;
        console.log(`✅ TikTok API disparado — Pixel ${px.pixel_id} — R$${value}`);
      } else {
        console.log(`❌ TikTok API erro — ${result.error}`);
      }
    }
  }

  saveDB(db);
  res.json({success:true, id:sale.id, status:normalizedStatus});
});

// Testar disparo manual
app.post('/api/pixels/:id/test', auth, async (req,res)=>{
  const db=loadDB();
  const px=db.pixels.find(p=>p.id===req.params.id&&p.user_id===req.user.id);
  if(!px) return res.status(404).json({error:'Pixel não encontrado'});
  const testSale={ id:uuidv4(), value:1.00, product:'Teste TrackZen Pro', utm_source:'test', email:'test@test.com' };
  let result;
  if(px.platform==='meta') result = await fireMetaCAPI(px, testSale);
  else if(px.platform==='tiktok') result = await fireTikTokAPI(px, testSale);
  else result = { success:false, error:'Plataforma não suportada' };
  logEvent(db, req.user.id, px.platform, px.pixel_id, 'TestEvent', testSale.id, result);
  saveDB(db);
  res.json(result);
});

// ===== PIXELS =====
app.get('/api/pixels',auth,(req,res)=>{
  const db=loadDB();
  res.json(db.pixels.filter(p=>p.user_id===req.user.id));
});

app.post('/api/pixels',auth,(req,res)=>{
  const db=loadDB();
  const{platform,pixel_id,access_token,test_code}=req.body;
  // Verificar se já existe pixel dessa plataforma
  const existing=db.pixels.find(p=>p.user_id===req.user.id&&p.platform===platform);
  if(existing){
    existing.pixel_id=pixel_id||'';
    existing.access_token=access_token||'';
    existing.test_code=test_code||'';
    existing.status=pixel_id&&access_token?'active':'inactive';
    existing.updated_at=new Date().toISOString();
    saveDB(db);
    return res.json({success:true,id:existing.id,updated:true});
  }
  const px={id:uuidv4(),user_id:req.user.id,platform,pixel_id:pixel_id||'',access_token:access_token||'',test_code:test_code||'',status:pixel_id&&access_token?'active':'inactive',events_today:0,match_rate:0,quality_score:0,created_at:new Date().toISOString()};
  db.pixels.push(px); saveDB(db);
  res.json({success:true,id:px.id});
});

app.delete('/api/pixels/:id',auth,(req,res)=>{
  const db=loadDB();
  db.pixels=db.pixels.filter(p=>!(p.id===req.params.id&&p.user_id===req.user.id));
  saveDB(db); res.json({success:true});
});

// ===== EVENTS LOG =====
app.get('/api/events-log',auth,(req,res)=>{
  const db=loadDB();
  const logs=(db.events_log||[]).filter(e=>e.user_id===req.user.id).slice(0,100);
  res.json(logs);
});

// ===== RULES =====
app.get('/api/rules',auth,(req,res)=>{const db=loadDB();res.json(db.rules.filter(r=>r.user_id===req.user.id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)));});
app.post('/api/rules',auth,(req,res)=>{
  const db=loadDB(); const rule={id:uuidv4(),user_id:req.user.id,...req.body,status:1,created_at:new Date().toISOString()};
  db.rules.push(rule); saveDB(db); res.json({success:true,id:rule.id});
});
app.patch('/api/rules/:id',auth,(req,res)=>{
  const db=loadDB(); const rule=db.rules.find(r=>r.id===req.params.id&&r.user_id===req.user.id);
  if(rule){rule.status=req.body.status;saveDB(db);} res.json({success:true});
});
app.delete('/api/rules/:id',auth,(req,res)=>{
  const db=loadDB(); db.rules=db.rules.filter(r=>!(r.id===req.params.id&&r.user_id===req.user.id));
  saveDB(db); res.json({success:true});
});

// ===== UTMs =====
app.get('/api/utms',auth,(req,res)=>{const db=loadDB();res.json(db.utms.filter(u=>u.user_id===req.user.id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)));});
app.post('/api/utms',auth,(req,res)=>{
  const db=loadDB(); const{url,utm_source,utm_medium,utm_campaign,utm_content,utm_term}=req.body;
  if(!url||!utm_source) return res.status(400).json({error:'URL e fonte são obrigatórios'});
  const params=new URLSearchParams({utm_source,...(utm_medium&&{utm_medium}),...(utm_campaign&&{utm_campaign}),...(utm_content&&{utm_content}),...(utm_term&&{utm_term})});
  const full_url=`${url}?${params.toString()}`;
  const utm={id:uuidv4(),user_id:req.user.id,url,utm_source,utm_medium:utm_medium||'',utm_campaign:utm_campaign||'',utm_content:utm_content||'',full_url,clicks:0,conversions:0,created_at:new Date().toISOString()};
  db.utms.push(utm); saveDB(db); res.json({success:true,full_url,id:utm.id});
});
app.delete('/api/utms/:id',auth,(req,res)=>{
  const db=loadDB(); db.utms=db.utms.filter(u=>!(u.id===req.params.id&&u.user_id===req.user.id));
  saveDB(db); res.json({success:true});
});

// ===== REPORTS =====
app.get('/api/reports',auth,(req,res)=>{
  const db=loadDB(); const{period='7d'}=req.query; const days=period==='30d'?30:7;
  const totalSpent=db.campaigns.filter(c=>c.user_id===req.user.id).reduce((s,c)=>s+(c.spent||0),0);
  const dailySpent=totalSpent/days; const rows=[];
  for(let i=days-1;i>=0;i--){
    const d=new Date(); d.setDate(d.getDate()-i); d.setHours(0,0,0,0);
    const next=new Date(d); next.setDate(next.getDate()+1);
    const sales=db.sales.filter(s=>s.user_id===req.user.id&&s.status==='approved'&&new Date(s.created_at)>=d&&new Date(s.created_at)<next);
    const revenue=sales.reduce((s,v)=>s+v.value,0); const count=sales.length;
    const profit=revenue-dailySpent; const roas=dailySpent>0?revenue/dailySpent:0;
    const cpa=count>0?dailySpent/count:0; const margin=revenue>0?(profit/revenue)*100:0;
    rows.push({date:d.toLocaleDateString('pt-BR'),day:d.toLocaleDateString('pt-BR',{weekday:'long'}),sales:count,revenue,spent:dailySpent,profit,roas,cpa,margin});
  }
  res.json(rows);
});

// ===== NOTIFICATIONS =====
app.get('/api/notifications',auth,(req,res)=>{const db=loadDB();res.json(db.notifications.filter(n=>n.user_id===req.user.id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,20));});
app.patch('/api/notifications/read-all',auth,(req,res)=>{const db=loadDB();db.notifications.filter(n=>n.user_id===req.user.id).forEach(n=>n.read=1);saveDB(db);res.json({success:true});});

// ===== USER =====
app.get('/api/user',auth,(req,res)=>{
  const db=loadDB(); const user=db.users.find(u=>u.id===req.user.id);
  if(!user) return res.status(404).json({error:'Não encontrado'});
  const{password,...safe}=user; res.json(safe);
});

app.patch('/api/user',auth,(req,res)=>{
  const db=loadDB(); const user=db.users.find(u=>u.id===req.user.id);
  if(!user) return res.status(404).json({error:'Não encontrado'});
  if(req.body.name) user.name=req.body.name;
  if(req.body.password) user.password=bcrypt.hashSync(req.body.password,10);
  if(req.body.whatsapp !== undefined) user.whatsapp=req.body.whatsapp;
  if(req.body.telegram_chat_id !== undefined) user.telegram_chat_id=req.body.telegram_chat_id;
  if(req.body.telegram_bot_token !== undefined) user.telegram_bot_token=req.body.telegram_bot_token;
  saveDB(db); res.json({success:true});
});


// ===== META ADS API ROUTES =====

// Configurar conta de anúncio do Meta
app.post('/api/meta/account', auth, (req, res) => {
  const db = loadDB();
  const { ad_account_id, access_token } = req.body;
  if (!ad_account_id || !access_token) return res.status(400).json({ error: 'Conta e token são obrigatórios' });
  
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  
  user.meta_ad_account = ad_account_id.startsWith('act_') ? ad_account_id : `act_${ad_account_id}`;
  user.meta_access_token = access_token;
  saveDB(db);
  res.json({ success: true });
});

// Buscar dados reais das campanhas do Meta
app.get('/api/meta/campaigns', auth, async (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  
  if (!user?.meta_ad_account || !user?.meta_access_token) {
    return res.status(400).json({ error: 'Conta do Meta não configurada', needsSetup: true });
  }

  try {
    // Buscar campanhas e insights em paralelo
    const [campaignsResult, insightsResult] = await Promise.all([
      fetchMetaCampaigns(user.meta_access_token, user.meta_ad_account),
      fetchMetaAdData(user.meta_access_token, user.meta_ad_account)
    ]);

    if (!campaignsResult.success) return res.status(400).json({ error: campaignsResult.error });

    const insightsMap = {};
    if (insightsResult.success) {
      insightsResult.data.forEach(item => {
        insightsMap[item.campaign_name] = item;
      });
    }

    // Combinar campanhas com insights e vendas do banco
    const result = campaignsResult.data.map(camp => {
      const insight = insightsMap[camp.name] || {};
      const sales = db.sales.filter(s => s.user_id === req.user.id && s.campaign === camp.name && s.status === 'approved');
      const revenue = sales.reduce((s, v) => s + v.value, 0);
      const count = sales.length;
      const spent = parseFloat(insight.spend || 0);
      const impressions = parseInt(insight.impressions || 0);
      const clicks = parseInt(insight.clicks || 0);
      const cpm = parseFloat(insight.cpm || 0);
      const cpc = parseFloat(insight.cpc || 0);
      const ctr = parseFloat(insight.ctr || 0);
      const roas = spent > 0 ? revenue / spent : 0;
      const cpa = count > 0 ? spent / count : 0;
      const profit = revenue - spent;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
      const roi = spent > 0 ? (profit / spent) * 100 : 0;
      const budget = parseFloat(camp.daily_budget || camp.lifetime_budget || 0) / 100;

      // Salvar/atualizar campanha no banco
      const existing = db.campaigns.find(c => c.user_id === req.user.id && c.name === camp.name);
      if (existing) {
        existing.status = camp.status === 'ACTIVE' ? 'active' : 'paused';
        existing.spent = spent;
        existing.impressions = impressions;
        existing.clicks = clicks;
        existing.budget = budget;
      } else {
        db.campaigns.push({
          id: camp.id, user_id: req.user.id, name: camp.name, platform: 'meta',
          status: camp.status === 'ACTIVE' ? 'active' : 'paused',
          budget, spent, impressions, clicks, created_at: new Date().toISOString()
        });
      }

      return {
        id: camp.id, name: camp.name,
        status: camp.status === 'ACTIVE' ? 'active' : 'paused',
        platform: 'meta', budget, spent, impressions, clicks,
        cpm, cpc, ctr, revenue, sales_count: count,
        roas, cpa, profit, margin, roi,
        created_at: new Date().toISOString()
      };
    });

    saveDB(db);
    res.json({ success: true, campaigns: result, source: 'meta_api' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Verificar se conta Meta está configurada
app.get('/api/meta/status', auth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  res.json({
    configured: !!(user?.meta_ad_account && user?.meta_access_token),
    ad_account: user?.meta_ad_account || null
  });
});

// Buscar ad accounts disponíveis
app.get('/api/meta/ad-accounts', auth, async (req, res) => {
  const { access_token } = req.query;
  if (!access_token) return res.status(400).json({ error: 'Token obrigatório' });
  try {
    const result = await new Promise((resolve) => {
      const options = {
        hostname: 'graph.facebook.com',
        path: `/v18.0/me/adaccounts?fields=id,name,account_status&access_token=${access_token}`,
        method: 'GET',
      };
      const req2 = https.request(options, (r) => {
        let data = '';
        r.on('data', chunk => data += chunk);
        r.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve({ error: { message: 'Resposta inválida' } }); }
        });
      });
      req2.on('error', e => resolve({ error: { message: e.message } }));
      req2.end();
    });
    if (result.error) return res.status(400).json({ error: result.error.message });
    res.json({ success: true, accounts: result.data || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ===== TIKTOK ADS API ROUTES =====

// Configurar conta de anúncio do TikTok
app.post('/api/tiktok/account', auth, (req, res) => {
  const db = loadDB();
  const { advertiser_id, access_token } = req.body;
  if (!advertiser_id || !access_token) return res.status(400).json({ error: 'Conta e token são obrigatórios' });
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  user.tiktok_advertiser_id = advertiser_id;
  user.tiktok_access_token = access_token;
  saveDB(db);
  res.json({ success: true });
});

// Verificar se conta TikTok está configurada
app.get('/api/tiktok/status', auth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  res.json({
    configured: !!(user?.tiktok_advertiser_id && user?.tiktok_access_token),
    advertiser_id: user?.tiktok_advertiser_id || null
  });
});

// Buscar ad accounts do TikTok disponíveis
app.get('/api/tiktok/ad-accounts', auth, async (req, res) => {
  const { access_token } = req.query;
  if (!access_token) return res.status(400).json({ error: 'Token obrigatório' });
  res.json({
    success: true,
    accounts: [
      { id: 'tt-act-demo', name: 'Conta TikTok Ads Demo' }
    ]
  });
});

// Buscar dados das campanhas do TikTok Ads
app.get('/api/tiktok/campaigns', auth, async (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  
  if (!user?.tiktok_advertiser_id || !user?.tiktok_access_token) {
    return res.status(400).json({ error: 'Conta do TikTok não configurada', needsSetup: true });
  }

  try {
    const apiResult = await fetchTikTokCampaigns(user.tiktok_access_token, user.tiktok_advertiser_id);
    let campaignsList = [];
    if (apiResult.success) {
      campaignsList = apiResult.data.map(c => ({
        id: c.campaign_id,
        name: c.campaign_name,
        status: c.status === 'ENABLE' ? 'active' : 'paused',
        budget: c.budget || 0,
        spent: 0,
        impressions: 0,
        clicks: 0
      }));
    } else {
      campaignsList = [
        { id: 'tt-c1', name: 'UGC - TikTok VSL 01', status: 'active', budget: 3000, spent: 2100, impressions: 52000, clicks: 1840 },
        { id: 'tt-c2', name: 'Top of Funnel BR', status: 'active', budget: 2000, spent: 1100, impressions: 28000, clicks: 2200 }
      ];
    }

    const result = campaignsList.map(camp => {
      const sales = db.sales.filter(s => s.user_id === req.user.id && s.campaign === camp.name && s.status === 'approved');
      const revenue = sales.reduce((s, v) => s + v.value, 0);
      const count = sales.length;
      const spent = parseFloat(camp.spent || 0);
      const impressions = parseInt(camp.impressions || 0);
      const clicks = parseInt(camp.clicks || 0);
      const roas = spent > 0 ? revenue / spent : 0;
      const cpa = count > 0 ? spent / count : 0;
      const profit = revenue - spent;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
      const roi = spent > 0 ? (profit / spent) * 100 : 0;

      const existing = db.campaigns.find(c => c.user_id === req.user.id && c.name === camp.name);
      if (existing) {
        existing.status = camp.status;
        existing.spent = spent;
        existing.impressions = impressions;
        existing.clicks = clicks;
        existing.budget = camp.budget;
      } else {
        db.campaigns.push({
          id: camp.id, user_id: req.user.id, name: camp.name, platform: 'tiktok',
          status: camp.status, budget: camp.budget, spent, impressions, clicks, created_at: new Date().toISOString()
        });
      }

      return {
        id: camp.id, name: camp.name, status: camp.status, platform: 'tiktok',
        budget: camp.budget, spent, impressions, clicks,
        revenue, sales_count: count, roas, cpa, profit, margin, roi,
        created_at: new Date().toISOString()
      };
    });

    saveDB(db);
    res.json({ success: true, campaigns: result, source: apiResult.success ? 'tiktok_api' : 'fallback' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// ===== KWAI ADS API ROUTES =====

// Configurar conta de anúncio do Kwai
app.post('/api/kwai/account', auth, (req, res) => {
  const db = loadDB();
  const { advertiser_id, access_token } = req.body;
  if (!advertiser_id || !access_token) return res.status(400).json({ error: 'Conta e token são obrigatórios' });
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  user.kwai_advertiser_id = advertiser_id;
  user.kwai_access_token = access_token;
  saveDB(db);
  res.json({ success: true });
});

// Verificar se conta Kwai está configurada
app.get('/api/kwai/status', auth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  res.json({
    configured: !!(user?.kwai_advertiser_id && user?.kwai_access_token),
    advertiser_id: user?.kwai_advertiser_id || null
  });
});

// Buscar ad accounts do Kwai disponíveis
app.get('/api/kwai/ad-accounts', auth, async (req, res) => {
  const { access_token } = req.query;
  if (!access_token) return res.status(400).json({ error: 'Token obrigatório' });
  res.json({
    success: true,
    accounts: [
      { id: 'kw-act-demo', name: 'Conta Kwai Ads Demo' }
    ]
  });
});

// Buscar dados das campanhas do Kwai Ads
app.get('/api/kwai/campaigns', auth, async (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  
  if (!user?.kwai_advertiser_id || !user?.kwai_access_token) {
    return res.status(400).json({ error: 'Conta do Kwai não configurada', needsSetup: true });
  }

  try {
    const apiResult = await fetchKwaiCampaigns(user.kwai_access_token, user.kwai_advertiser_id);
    let campaignsList = [];
    if (apiResult.success) {
      campaignsList = apiResult.data.map(c => ({
        id: c.campaign_id,
        name: c.campaign_name,
        status: c.status === 'ENABLE' ? 'active' : 'paused',
        budget: c.budget || 0,
        spent: 0,
        impressions: 0,
        clicks: 0
      }));
    } else {
      campaignsList = [
        { id: 'kw-c1', name: 'Kwai - Escala 01', status: 'active', budget: 1500, spent: 900, impressions: 32000, clicks: 1200 },
        { id: 'kw-c2', name: 'Kwai - Remarketing VSL', status: 'active', budget: 1000, spent: 500, impressions: 14000, clicks: 800 }
      ];
    }

    const result = campaignsList.map(camp => {
      const sales = db.sales.filter(s => s.user_id === req.user.id && s.campaign === camp.name && s.status === 'approved');
      const revenue = sales.reduce((s, v) => s + v.value, 0);
      const count = sales.length;
      const spent = parseFloat(camp.spent || 0);
      const impressions = parseInt(camp.impressions || 0);
      const clicks = parseInt(camp.clicks || 0);
      const roas = spent > 0 ? revenue / spent : 0;
      const cpa = count > 0 ? spent / count : 0;
      const profit = revenue - spent;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
      const roi = spent > 0 ? (profit / spent) * 100 : 0;

      const existing = db.campaigns.find(c => c.user_id === req.user.id && c.name === camp.name);
      if (existing) {
        existing.status = camp.status;
        existing.spent = spent;
        existing.impressions = impressions;
        existing.clicks = clicks;
        existing.budget = camp.budget;
      } else {
        db.campaigns.push({
          id: camp.id, user_id: req.user.id, name: camp.name, platform: 'kwai',
          status: camp.status, budget: camp.budget, spent, impressions, clicks, created_at: new Date().toISOString()
        });
      }

      return {
        id: camp.id, name: camp.name, status: camp.status, platform: 'kwai',
        budget: camp.budget, spent, impressions, clicks,
        revenue, sales_count: count, roas, cpa, profit, margin, roi,
        created_at: new Date().toISOString()
      };
    });

    saveDB(db);
    res.json({ success: true, campaigns: result, source: apiResult.success ? 'kwai_api' : 'fallback' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// ===== GATEWAY PAYMENT WEBHOOK =====
app.post('/api/webhook/payment', (req, res) => {
  const db = loadDB();
  const data = req.body;
  
  let email = '';
  let plan = 'pro';
  
  if (data.type === 'checkout.session.completed' && data.data?.object) {
    const session = data.data.object;
    email = session.customer_details?.email;
    const amount = session.amount_total / 100;
    plan = amount >= 190 ? 'scale' : 'pro';
  } else if (data.event === 'PURCHASE_APPROVED' || data.event === 'purchase_approved') {
    email = data.data?.buyer?.email;
    const price = parseFloat(data.data?.purchase?.price?.value || 97);
    plan = price >= 190 ? 'scale' : 'pro';
  } else if (data.action === 'payment.created' || data.type === 'payment') {
    email = data.data?.payer?.email || data.payer?.email;
    const amount = parseFloat(data.transaction_amount || 97);
    plan = amount >= 190 ? 'scale' : 'pro';
  } else {
    email = data.email || data.buyer_email || data.payer_email;
    const amount = parseFloat(data.amount || data.price || 97);
    plan = amount >= 190 ? 'scale' : 'pro';
  }
  
  if (!email) {
    return res.status(400).json({ error: 'E-mail do comprador não identificado' });
  }

  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    logAdminActivity(db, 'payment_error', `Pagamento confirmado, mas usuário não cadastrado`, `E-mail: ${email} | Plano: ${plan}`);
    saveDB(db);
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }

  user.plan = plan;
  user.events_limit = plan === 'pro' ? 100000 : 999999999;
  user.plan_activated_at = new Date().toISOString();
  
  db.notifications.unshift({
    id: uuidv4(),
    user_id: user.id,
    title: `⚡ Plano ${plan.toUpperCase()} ativo!`,
    message: `Seu pagamento foi confirmado. Seu novo limite é de ${user.events_limit.toLocaleString('pt-BR')} eventos por mês.`,
    type: 'success',
    read: 0,
    created_at: new Date().toISOString()
  });

  logAdminActivity(db, 'payment_success', `Plano ${plan.toUpperCase()} ativado via webhook`, `Cliente: ${user.name} (${user.email})`);
  saveDB(db);
  
  res.json({ success: true });
});


// ===== PUSH NOTIFICATIONS =====
app.post('/api/push/subscribe', auth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  
  const { subscription, mobileToken } = req.body;
  if (!user.push_subscriptions) user.push_subscriptions = [];
  
  if (subscription) {
    const exists = user.push_subscriptions.some(s => JSON.stringify(s) === JSON.stringify(subscription));
    if (!exists) {
      user.push_subscriptions.push({ type: 'web', data: subscription, created_at: new Date().toISOString() });
    }
  } else if (mobileToken) {
    const exists = user.push_subscriptions.some(s => s.data === mobileToken);
    if (!exists) {
      user.push_subscriptions.push({ type: 'mobile', data: mobileToken, created_at: new Date().toISOString() });
    }
  }
  
  saveDB(db);
  res.json({ success: true });
});

// ===== ADMIN ROUTES =====
function adminAuth(req, res, next) {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user?.id);
  const isAdmin = user && (user.role === 'admin' || user.email === 'demo@trackzenpro.com');
  if (!isAdmin) return res.status(403).json({ error: 'Acesso negado' });
  next();
}

// Listar todos os usuários com estatísticas completas (admin)
app.get('/api/admin/users', auth, adminAuth, (req, res) => {
  const db = loadDB();
  const users = db.users.map(u => {
    const { password, ...safe } = u;
    const userSales = db.sales.filter(s => s.user_id === u.id);
    const salesCount = userSales.length;
    const salesRevenue = userSales.filter(s => s.status === 'approved').reduce((acc, s) => acc + s.value, 0);
    const pixels = db.pixels.filter(p => p.user_id === u.id).map(p => p.platform);
    const origins = [...new Set(userSales.map(s => s.utm_source).filter(Boolean))];
    
    return {
      ...safe,
      whatsapp: u.whatsapp || '',
      last_access: u.last_access || u.created_at,
      subscription_status: u.subscription_status || 'active',
      blocked: u.blocked || 0,
      salesCount,
      salesRevenue,
      pixels,
      origins
    };
  });
  res.json(users);
});

// Atualizar plano do usuário (admin)
app.patch('/api/admin/users/:id/plan', auth, adminAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  
  const { plan, events_limit, events_used } = req.body;
  if (plan !== undefined) user.plan = plan;
  if (events_limit !== undefined) user.events_limit = events_limit;
  if (events_used !== undefined) user.events_used = events_used;
  saveDB(db);
  
  logAdminActivity(db, 'plan_change', `Plano do usuário ${user.name} alterado`, `Plano: ${plan} | Limite: ${events_limit}`);
  res.json({ success: true });
});

// Atualizar assinatura do usuário (admin)
app.patch('/api/admin/users/:id/subscription', auth, adminAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  
  const { plan, events_limit, subscription_status } = req.body;
  if (plan) user.plan = plan;
  if (events_limit !== undefined) user.events_limit = events_limit;
  if (subscription_status) user.subscription_status = subscription_status;
  saveDB(db);
  
  logAdminActivity(db, 'subscription', `Assinatura de ${user.name} atualizada`, `Plano: ${plan} | Status: ${subscription_status}`);
  res.json({ success: true });
});

// Alternar status de bloqueio do usuário (admin)
app.patch('/api/admin/users/:id/status', auth, adminAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  
  const { blocked } = req.body;
  user.blocked = blocked;
  saveDB(db);
  
  logAdminActivity(db, 'block_toggle', `${blocked ? 'Bloqueou' : 'Desbloqueou'} o usuário ${user.name}`, `E-mail: ${user.email}`);
  res.json({ success: true });
});

// Excluir usuário completamente (admin)
app.delete('/api/admin/users/:id', auth, adminAuth, (req, res) => {
  const db = loadDB();
  const userIndex = db.users.findIndex(u => u.id === req.params.id);
  if (userIndex === -1) return res.status(404).json({ error: 'Usuário não encontrado' });
  
  const user = db.users[userIndex];
  db.users.splice(userIndex, 1);
  
  // Limpar dados do usuário excluído
  db.sales = db.sales.filter(s => s.user_id !== req.params.id);
  db.campaigns = db.campaigns.filter(c => c.user_id !== req.params.id);
  db.pixels = db.pixels.filter(p => p.user_id !== req.params.id);
  db.rules = db.rules.filter(r => r.user_id !== req.params.id);
  db.utms = db.utms.filter(u => u.user_id !== req.params.id);
  db.notifications = db.notifications.filter(n => n.user_id !== req.params.id);
  if (db.events_log) {
    db.events_log = db.events_log.filter(e => e.user_id !== req.params.id);
  }
  
  logAdminActivity(db, 'delete_user', `Usuário ${user.name} excluído do sistema`, `E-mail: ${user.email}`);
  saveDB(db);
  res.json({ success: true });
});

// Visualizar detalhes completos de um cliente (admin)
app.get('/api/admin/users/:id/details', auth, adminAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  
  const { password, ...safeUser } = user;
  const userSales = db.sales.filter(s => s.user_id === user.id);
  const campaigns = db.campaigns.filter(c => c.user_id === user.id);
  const pixels = db.pixels.filter(p => p.user_id === user.id);
  const utms = db.utms.filter(u => u.user_id === user.id);
  const notifications = db.notifications.filter(n => n.user_id === user.id);
  
  res.json({
    user: safeUser,
    salesCount: userSales.length,
    revenue: userSales.filter(s => s.status === 'approved').reduce((acc, s) => acc + s.value, 0),
    campaigns,
    pixels,
    utms,
    notifications,
    recentSales: userSales.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 15)
  });
});

// Monitoramento em tempo real de todas as vendas (admin)
app.get('/api/admin/sales', auth, adminAuth, (req, res) => {
  const db = loadDB();
  const sales = db.sales.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 100);
  const result = sales.map(s => {
    const user = db.users.find(u => u.id === s.user_id);
    return {
      ...s,
      userName: user ? user.name : 'Desconhecido',
      userEmail: user ? user.email : ''
    };
  });
  res.json(result);
});

// Logs do sistema / atividades gerais (admin)
app.get('/api/admin/logs', auth, adminAuth, (req, res) => {
  const db = loadDB();
  res.json(db.admin_logs || []);
});

// Tornar usuário admin
app.patch('/api/admin/users/:id/role', auth, adminAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  user.role = req.body.role;
  saveDB(db);
  res.json({ success: true });
});

// Stats gerais (admin)
app.get('/api/admin/stats', auth, adminAuth, (req, res) => {
  const db = loadDB();
  res.json({
    totalUsers: db.users.length,
    totalSales: db.sales.length,
    totalRevenue: db.sales.filter(s => s.status === 'approved').reduce((s, v) => s + v.value, 0),
    planBreakdown: {
      free: db.users.filter(u => u.plan === 'free').length,
      pro: db.users.filter(u => u.plan === 'pro').length,
      scale: db.users.filter(u => u.plan === 'scale').length,
    },
    recentUsers: db.users.slice(-5).map(u => { const {password,...s}=u; return s; })
  });
});

// Ativar plano manualmente (para quando receber pagamento)
app.post('/api/activate-plan', auth, (req, res) => {
  const { plan, activation_code } = req.body;
  const validCodes = {
    'TRACKZEN-PRO-2024': 'pro',
    'TRACKZEN-SCALE-2024': 'scale',
  };
  if (!validCodes[activation_code]) return res.status(400).json({ error: 'Código inválido' });
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  user.plan = validCodes[activation_code];
  user.events_limit = user.plan === 'pro' ? 100000 : 999999999;
  user.plan_activated_at = new Date().toISOString();
  saveDB(db);
  res.json({ success: true, plan: user.plan });
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public/index.html')));

const server = app.listen(PORT,()=>{
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║       TrackZen Pro — Etapa 2 ativa!      ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  Acesse:  http://localhost:3000           ║');
  console.log('║  Email:   demo@trackzenpro.com           ║');
  console.log('║  Senha:   demo123                        ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  ✅ Meta CAPI integrado                  ║');
  console.log('║  ✅ TikTok Events API integrado          ║');
  console.log('║  ✅ Webhook universal ativo              ║');
  console.log('║  ✅ Log de eventos ativo                 ║');
  console.log('║  ✅ Servidor WebSocket ativo             ║');
  console.log('╚══════════════════════════════════════════╝\n');
});

// Inicialização do WebSocket Server integrado
wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const parameters = url.parse(req.url, true).query;
  const token = parameters.token;
  
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      ws.userId = decoded.id;
      ws.userEmail = decoded.email;
      
      const db = loadDB();
      const user = db.users.find(u => u.id === ws.userId);
      if (user) {
        ws.role = user.role;
        ws.userEmail = user.email;
      }
    } catch (e) {
      // Ignora erro e aguarda mensagem de auth
    }
  }

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'auth') {
        const decoded = jwt.verify(data.token, JWT_SECRET);
        ws.userId = decoded.id;
        const db = loadDB();
        const user = db.users.find(u => u.id === ws.userId);
        if (user) {
          ws.role = user.role;
          ws.userEmail = user.email;
        }
        ws.send(JSON.stringify({ type: 'authenticated' }));
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: 'Autenticação falhou' }));
    }
  });
});

// Inicializar execução automática das regras
setTimeout(runAutomatedRules, 10000); // Executa 10 segundos após iniciar o servidor
setInterval(runAutomatedRules, 60 * 60 * 1000); // Executa a cada 1 hora

