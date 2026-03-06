const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// --- SISTEMA DE DADOS (STATELESS - NUVEM) ---
// 1. Aprovações: Salvas diretamente no Mercado Pago (Metadata)
// 2. IPs Permitidos: Carregados de Variáveis de Ambiente + Memória Volátil

// Estado em memória (Sincronizado com arquivos ou apenas memória no modo stateless)
const DB = {
  approvals: {},
  allowed_ips: []
};

// Lista de IPs permitidos (Inicia com o IP mestre do .env e IPs fixos solicitados)
// Nota: Em hospedagem grátis (Render), IPs adicionados via Admin resetam ao reiniciar.
const FIXED_IPS = [
  "179.241.212.87",
  "181.192.123.17",
  "172.225.100.150",
  "172.225.83.34",
  "104.28.63.113",
  "181.192.123.15",
  "177.72.138.128"
];

let allowedIps = [...FIXED_IPS];

// Carrega IPs do ambiente (separados por vírgula)
const loadEnvIps = () => {
  const envIps = process.env.ALLOWED_IPS ? process.env.ALLOWED_IPS.split(',').map(ip => ip.trim()) : [];
  // Mescla com os atuais e fixos, evitando duplicatas
  allowedIps = [...new Set([...FIXED_IPS, ...allowedIps, ...envIps])];
};

// --- MIDDLEWARES ---
const checkIp = (req, res, next) => {
  // Pega o IP real, considerando proxies (comum em hospedagem online)
  const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const cleanIp = clientIp.replace('::ffff:', '');
  
  // IPs locais sempre permitidos
  if (cleanIp === '127.0.0.1' || cleanIp === '::1') return next();
  
  // Rotas públicas (Admin, Login e Webhooks se houver)
  if (req.path.startsWith('/admin') || req.path === '/login' || req.path.startsWith('/api/admin')) return next();

  // Garante que os IPs do ambiente estão carregados
  loadEnvIps();

  // Verifica Whitelist
  if (allowedIps.includes(cleanIp)) return next();

  console.log(`🚫 Acesso bloqueado: ${cleanIp}`);
  res.status(403).send(`<h1>Acesso Negado</h1><p>Seu IP (${cleanIp}) não está autorizado.</p>`);
};

app.use(checkIp);
app.use(express.static(path.join(__dirname, 'public')));

// --- ROTAS ADMIN ---
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const envUser = process.env.ADMIN_USER || 'Admin';
  const envPass = process.env.ADMIN_PASS || 'adminMIL';
  
  if (username === envUser && password === envPass) res.json({ success: true });
  else res.status(401).json({ success: false });
});

app.get('/api/admin/ips', (req, res) => {
  loadEnvIps();
  res.json(allowedIps);
});

app.post('/api/admin/ips', (req, res) => {
  const { ip } = req.body;
  if (ip && !allowedIps.includes(ip)) {
    allowedIps.push(ip);
  }
  res.json({ success: true, ips: allowedIps });
});

app.delete('/api/admin/ips/:ip', (req, res) => {
  // Apenas remove da memória. Se estiver no .env, voltará no próximo request.
  allowedIps = allowedIps.filter(i => i !== req.params.ip);
  res.json({ success: true, ips: allowedIps });
});

// --- ROTAS DE PAGAMENTO ---
// Configuração Mercado Pago
const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN });
const payment = new Payment(client);

// Rota principal de monitoramento
app.get('/payments/search', async (req, res) => {
  try {
    // Busca últimos 50 pagamentos Pix
    const result = await payment.search({ options: { sort: 'date_created', criteria: 'desc', limit: 50 } });
    const pixPayments = result.results ? result.results.filter(p => p.payment_method_id === 'pix') : [];

    // Mapeia para formato simples
    const responseData = pixPayments.map(p => {
      // Tenta extrair nome do pagador de várias fontes
      let name = 'N/A';
      if (p.payer?.first_name) {
          name = `${p.payer.first_name} ${p.payer.last_name || ''}`.trim();
      } else if (p.payer?.email) {
          name = p.payer.email;
      } else if (p.metadata?.payer_name) {
          name = p.metadata.payer_name;
      } else if (p.description && p.description.toLowerCase().includes('pix de')) {
          name = p.description;
      } else {
          // Última tentativa: Tentar extrair do título ou descrição se disponível
          name = p.description || 'Pagador Desconhecido';
      }

      // Recupera aprovação do Metadata do Mercado Pago ou da Memória Local (Fallback)
      const approvalData = p.metadata?.approval_data || p.metadata?.approvalData || DB.approvals[p.id] || null;

      return {
        id: p.id,
        status: p.status, // pending, approved, etc.
        amount: p.transaction_amount,
        date: p.date_created,
        description: p.description,
        payer_email: p.payer?.email || 'N/A',
        payer_name: name,
        approval: approvalData // Agora vem direto do MP!
      };
    });

    res.json(responseData);
  } catch (error) {
    console.error('Erro Mercado Pago:', error);
    res.status(500).json({ error: 'Erro ao buscar pagamentos' });
  }
});

// Rota para aprovar manualmente (Salva no Metadata do MP)
app.post('/payments/:id/approve', async (req, res) => {
  const { id } = req.params;
  const approvalData = {
    attendant: req.body.attendant,
    orderNumber: req.body.orderNumber,
    store: req.body.store,
    description: req.body.description,
    approvedAt: new Date().toISOString()
  };

  try {
    // Tenta atualizar no Mercado Pago (Metadata)
    // Nota: O método 'update' pode não existir em todas as versões da SDK.
    // Se falhar, usaremos memória volátil como fallback para não travar a operação.
    try {
        if (payment.update) {
            await payment.update({
                id: id,
                body: {
                    metadata: {
                        approval_data: approvalData
                    }
                }
            });
            console.log(`✅ Pagamento ${id} aprovado via Metadata MP.`);
        } else {
            throw new Error('Método payment.update não disponível na SDK');
        }
    } catch (mpError) {
        console.warn('⚠️ Falha ao salvar no Mercado Pago (Metadata):', mpError.message);
        console.warn('🔄 Usando Memória Volátil como Fallback.');
        
        // Fallback: Salva na memória local do servidor
        // Em deploy gratuito, isso reseta ao reiniciar, mas garante o funcionamento imediato.
        DB.approvals[id] = approvalData;
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Erro crítico na aprovação:', error);
    res.status(500).json({ error: 'Erro ao processar aprovação' });
  }
});

// Cria um pagamento Pix
app.post('/process_payment', async (req, res) => {
  try {
    const { transaction_amount, description, email, identificationType, identificationNumber } = req.body;

    const paymentData = {
      transaction_amount: Number(transaction_amount),
      description: description,
      payment_method_id: 'pix',
      payer: {
        email: email,
        identification: {
          type: identificationType,
          number: identificationNumber
        }
      }
    };

    const data = await payment.create({ body: paymentData });
    const result = data;

    res.json({
      id: result.id,
      status: result.status,
      detail: result.status_detail,
      qr_code: result.point_of_interaction.transaction_data.qr_code,
      qr_code_base64: result.point_of_interaction.transaction_data.qr_code_base64
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao criar pagamento' });
  }
});

// Busca status de um pagamento específico
app.get('/payment/:id', async (req, res) => {
  try {
    const result = await payment.get({ id: req.params.id });
    res.json({
      id: result.id,
      status: result.status,
      status_detail: result.status_detail
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar pagamento' });
  }
});

// --- INICIALIZAÇÃO ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  loadEnvIps();
  
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  let localIp = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) localIp = net.address;
    }
  }

  console.log('\n================================================');
  console.log('       SISTEMIL - MONITORAMENTO PIX        ');
  console.log('================================================');
  console.log(`✅ Servidor Rodando!`);
  console.log(`🏠 Local:   http://localhost:${PORT}`);
  console.log(`🌐 Rede:    http://${localIp}:${PORT}`);
  console.log(`🔐 Admin:   http://${localIp}:${PORT}/admin`);
  console.log('================================================\n');
});
