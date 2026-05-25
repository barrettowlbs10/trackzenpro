# 📱 TrackZen Pro — Aplicativo Mobile (React Native / Expo)

Este é o aplicativo mobile do **TrackZen Pro**, desenvolvido em React Native e Expo. Ele se conecta à API local do projeto e fornece notificações de vendas em tempo real via WebSocket com som personalizado e vibração.

---

## 🚀 Como rodar o aplicativo

### Passo 1 — Instale o Expo Go no seu celular
* **Android**: Procure por **Expo Go** na Google Play Store.
* **iOS**: Procure por **Expo Go** na Apple App Store.

### Passo 2 — Instale as dependências
Abra uma nova janela de terminal, navegue até a pasta `mobile` e execute:
```bash
cd mobile
npm install
```

### Passo 3 — Configure o IP do seu servidor local
No arquivo `mobile/App.js`, altere as constantes `API_URL` e `WS_URL` na linha 25 e 26 para usarem o IP local da sua máquina em vez de `localhost` (para que o celular consiga acessar o servidor rodando no seu computador):
```javascript
const API_URL = 'http://SEU_IP_LOCAL:3000/api';
const WS_URL = 'ws://SEU_IP_LOCAL:3000';
```
*(Você pode descobrir seu IP local executando `ipconfig` no terminal do Windows).*

### Passo 4 — Inicie o aplicativo
No terminal, dentro da pasta `mobile`, execute:
```bash
npm start
```

### Passo 5 — Abra no celular
* **Android**: Abra o app **Expo Go** no celular, vá em "Scan QR Code" e escaneie o código QR gerado no terminal.
* **iOS**: Abra a câmera padrão do iPhone, aponte para o código QR do terminal e clique no link amarelo para abrir no **Expo Go**.

---

## 🔔 Testando as Notificações de Venda em Tempo Real

1. Faça login no aplicativo usando a conta demo (`demo@trackzenpro.com` / `demo123`).
2. Mantenha o aplicativo aberto no celular.
3. No seu computador, simule uma nova venda enviando um disparo de webhook. Por exemplo, pelo Terminal (PowerShell):
   ```powershell
   Invoke-RestMethod -Uri "http://localhost:3000/api/webhook/demo-user-001" -Method Post -ContentType "application/json" -Body '{"product": "Curso Especialista", "value": 197.00, "status": "approved", "platform": "meta", "utm_source": "facebook"}'
   ```
4. O celular irá vibrar instantaneamente, tocar um som personalizado de caixa registradora ("ding-ding!") e disparar uma notificação push na tela mostrando a venda.
