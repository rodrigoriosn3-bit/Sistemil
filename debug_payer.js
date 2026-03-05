const { MercadoPagoConfig, Payment } = require('mercadopago');
require('dotenv').config();

const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN });
const payment = new Payment(client);

async function inspectPaymentPayload() {
  try {
    console.log('🔍 Buscando último pagamento Pix para inspeção...');
    const searchResult = await payment.search({ options: { limit: 1, sort: 'date_created', criteria: 'desc' } });
    
    if (!searchResult.results || searchResult.results.length === 0) {
      console.log('❌ Nenhum pagamento encontrado.');
      return;
    }

    const p = searchResult.results[0];
    console.log('📦 Payload Completo do Pagamento:');
    console.log(JSON.stringify(p, null, 2));
    
    // Foco nas possíveis localizações do nome
    console.log('\n--- Análise de Nome ---');
    console.log('payer:', p.payer);
    console.log('additional_info:', p.additional_info);
    console.log('transaction_details:', p.transaction_details);

  } catch (error) {
    console.error('❌ Erro:', error);
  }
}

inspectPaymentPayload();