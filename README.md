# TrackZen Pro

Plataforma de rastreamento de campanhas — Meta Ads, TikTok Ads, Google Ads.

## Como rodar

1. Abra a pasta `trackzenpro` no VSCode
2. Abra o terminal (Ctrl+`)
3. Execute:

```
npm install
npm start
```

4. Abra o navegador em: http://localhost:3000

## Login demo
- Email: demo@trackzenpro.com
- Senha: demo123

## Estrutura
- `server.js` — servidor backend (Node.js)
- `public/index.html` — frontend completo
- `data/trackzen.db` — banco de dados (criado automaticamente)

## Webhook URL
Para conectar uma plataforma de vendas:
1. Vá em Integrações > Webhooks
2. Crie um novo webhook
3. Copie a URL gerada
4. Cole no painel da sua plataforma de vendas
