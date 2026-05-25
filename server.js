const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'trackzenpro-secret-2024';
const DB_PATH = path.join(__dirname, 'data/db.json');

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
  db.users.push({ id:userId, name:'Usuário Demo', email:'demo@trackzenpro.com', password:bcrypt.hashSync('demo123',10), plan:'pro', events_used:78500, events_limit:100000, created_at:new Date().toISOString() });
  const camps = [
    {id:'c1',name:'ABO - Escala 03',platform:'meta',status:'active',budget:5000,spent:4200,impressions:48000,clicks:4385},
    {id:'c2',name:'CBO - Conversão',platform:'meta',status:'active',budget:3000,spent:2100,impressions:31200,clicks:2979},
    {id:'c3',name:'UGC - TikTok VSL 01',platform:'tiktok',status:'active',budget:3000,spent:2100,impressions:52000,clicks:1840},
    {id:'c4',name:'Remarketing - 7d',platform:'meta',status:'active',budget:2000,spent:980,impressions:14500,clicks:1245},
    {id:'c5',name:'ABO - Teste Criativo',platform:'meta',status:'paused',budget:1500,spent:680,impressions:9800,clicks:980},
    {id:'c6',name:'Top of Funnel BR',platform:'tiktok',status:'active',budget:2000,spent:1100,impressions:28000,clicks:2200},
    {id:'c7',name:'Google - Pesquisa BR',platform:'google',status:'active',budget:1500,spent:760,impressions:8200,clicks:512},
    {id:'c8',name:'Google - Display',platform:'google',status:'active',budget:800,spent:340,impressions:15600,clicks:1200},
  ];
  camps.forEach(c => db.campaigns.push({...c,user_id:userId,created_at:new Date().toISOString()}));
  const sources=['facebook','instagram','tiktok','google','direct'];
  const methods=['pix','card','boleto','pix','pix'];
  const values=[97,147,197,97,97,247];
  for(let i=0;i<80;i++){
    const d=new Date(); d.setMinutes(d.getMinutes()-i*18);
    const camp=camps[Math.floor(Math.random()*camps.length)];
    db.sales.push({id:uuidv4(),user_id:userId,platform:camp.platform,campaign:camp.name,utm_source:sources[Math.floor(Math.random()*sources.length)],utm_medium:'cpc',utm_campaign:camp.name,value:values[Math.floor(Math.random()*values.length)],status:Math.random()>0.05?'approved':'refunded',payment_method:methods[Math.floor(Math.random()*methods.length)],product:'Produto Principal',created_at:d.toISOString()});
  }
  db.pixels.push({id:'px1',user_id:userId,platform:'meta',pixel_id:'',access_token:'',status:'inactive',events_today:0,match_rate:0,quality_score:0,test_code:'',created_at:new Date().toISOString()});
  db.pixels.push({id:'px2',user_id:userId,platform:'tiktok',pixel_id:'',access_token:'',status:'inactive',events_today:0,match_rate:0,quality_score:0,created_at:new Date().toISOString()});
  db.rules.push({id:'r1',user_id:userId,name:'AUMENTA ORÇAMENTO 50% CPA 6,50',platform:'meta',condition_metric:'cpa',condition_operator:'lt',condition_value:6.50,action:'increase_budget',action_value:50,frequency:'3h',status:1,created_at:new Date().toISOString()});
  db.rules.push({id:'r2',user_id:userId,name:'DESATIVAR ANUNCIO CPA 10,50',platform:'meta',condition_metric:'cpa',condition_operator:'gt',condition_value:10.50,action:'pause_campaign',action_value:0,frequency:'2h',status:1,created_at:new Date().toISOString()});
  db.rules.push({id:'r3',user_id:userId,name:'GASTOU 9 REAIS NAO VENDEU DESLIGA',platform:'meta',condition_metric:'spent_no_sale',condition_operator:'gt',condition_value:9.00,action:'pause_campaign',action_value:0,frequency:'2h',status:0,created_at:new Date().toISOString()});
  db.utms.push({id:'u1',user_id:userId,url:'https://seusite.com/produto',utm_source:'facebook',utm_medium:'cpc',utm_campaign:'abo-escala-03',utm_content:'',full_url:'https://seusite.com/produto?utm_source=facebook&utm_medium=cpc&utm_campaign=abo-escala-03',clicks:4385,conversions:72,created_at:new Date().toISOString()});
  db.utms.push({id:'u2',user_id:userId,url:'https://seusite.com/produto',utm_source:'tiktok',utm_medium:'paid',utm_campaign:'ugc-vsl-01',utm_content:'',full_url:'https://seusite.com/produto?utm_source=tiktok&utm_medium=paid&utm_campaign=ugc-vsl-01',clicks:1840,conversions:38,created_at:new Date().toISOString()});
  db.notifications.push({id:'n1',user_id:userId,title:'Venda aprovada — R$197,00',message:'Google Ads · Campanha Pesquisa BR',type:'success',read:0,created_at:new Date().toISOString()});
  db.notifications.push({id:'n2',user_id:userId,title:'ROAS abaixo de 3x detectado',message:'TikTok · Top of Funnel BR',type:'warning',read:0,created_at:new Date().toISOString()});
  db.notifications.push({id:'n3',user_id:userId,title:'Campanha pausada automaticamente',message:'Meta · ABO Teste Criativo · ROAS 2,31x',type:'danger',read:0,created_at:new Date().toISOString()});
  saveDB(db);
  console.log('✅ Dados demo criados!');
}

seedDemo();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));

function auth(req,res,next){
  const token=req.headers.authorization?.split(' ')[1];
  if(!token) return res.status(401).json({error:'Não autorizado'});
  try{req.user=jwt.verify(token,JWT_SECRET);next();}
  catch{res.status(401).json({error:'Token inválido'});}
}

// ===== AUTH =====
app.post('/api/login',(req,res)=>{
  const{email,password}=req.body; const db=loadDB();
  const user=db.users.find(u=>u.email===email);
  if(!user||!bcrypt.compareSync(password,user.password)) return res.status(401).json({error:'Email ou senha incorretos'});
  const token=jwt.sign({id:user.id,email:user.email,name:user.name},JWT_SECRET,{expiresIn:'7d'});
  res.json({token,user:{id:user.id,name:user.name,email:user.email,plan:user.plan}});
});

app.post('/api/register',(req,res)=>{
  const{name,email,password}=req.body;
  if(!name||!email||!password) return res.status(400).json({error:'Preencha todos os campos'});
  const db=loadDB();
  if(db.users.find(u=>u.email===email)) return res.status(400).json({error:'Email já cadastrado'});
  const id=uuidv4();
  db.users.push({id,name,email,password:bcrypt.hashSync(password,10),plan:'free',events_used:0,events_limit:1000,created_at:new Date().toISOString()});
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
    raw: JSON.stringify(data),
    created_at: new Date().toISOString()
  };

  db.sales.push(sale);
  if(user) user.events_used=(user.events_used||0)+1;

  // Notificação
  if(normalizedStatus === 'approved'){
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
  saveDB(db); res.json({success:true});
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public/index.html')));

app.listen(PORT,()=>{
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
  console.log('╚══════════════════════════════════════════╝\n');
});
