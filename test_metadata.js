const { MercadoPagoConfig, Payment } = require('mercadopago');
require('dotenv').config();

const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN });
const payment = new Payment(client);

async function testMetadataUpdate() {
  try {
    // 1. Buscar um pagamento recente para teste
    console.log('🔍 Buscando último pagamento Pix...');
    const searchResult = await payment.search({ options: { limit: 1, sort: 'date_created', criteria: 'desc' } });
    
    if (!searchResult.results || searchResult.results.length === 0) {
      console.log('❌ Nenhum pagamento encontrado para teste.');
      return;
    }

    const paymentId = searchResult.results[0].id;
    console.log(`✅ Pagamento encontrado: ${paymentId}`);

    // 2. Tentar atualizar metadata
    console.log('📝 Tentando atualizar metadata...');
    const updateData = {
      metadata: {
        approval_data: {
          test: "true",
          updated_at: new Date().toISOString()
        }
      }
    };

    // NOTA: A SDK do Mercado Pago pode ter peculiaridades no método update.
    // Vamos testar a chamada padrão.
    const updateResult = await payment.update({
        id: paymentId,
        body: updateData
    });

    console.log('✅ Sucesso! Resposta da atualização:', JSON.stringify(updateResult.metadata, null, 2));

  } catch (error) {
    console.error('❌ Erro no teste:', error);
    if (error.cause) console.error('Causa:', JSON.stringify(error.cause, null, 2));
  }
}

testMetadataUpdate();