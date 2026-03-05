const { MercadoPagoConfig, Payment } = require('mercadopago');
require('dotenv').config();

const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN });
const payment = new Payment(client);

async function inspectSinglePayment() {
  try {
    // 1. Buscar ID do último pagamento
    const searchResult = await payment.search({ options: { limit: 1, sort: 'date_created', criteria: 'desc' } });
    if (searchResult.results.length === 0) return console.log('Sem pagamentos.');
    
    const id = searchResult.results[0].id;
    console.log(`🔍 Buscando detalhes profundos do ID: ${id}`);

    // 2. Buscar detalhes completos (GET)
    const detailedPayment = await payment.get({ id: id });
    
    console.log('📦 Payer Info (GET):', JSON.stringify(detailedPayment.payer, null, 2));
    console.log('📦 Metadata:', JSON.stringify(detailedPayment.metadata, null, 2));
    console.log('📦 Transaction Details:', JSON.stringify(detailedPayment.transaction_details, null, 2));
    
  } catch (error) {
    console.error('❌ Erro:', error);
  }
}

inspectSinglePayment();