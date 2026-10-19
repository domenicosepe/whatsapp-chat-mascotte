import { authenticate } from "../shopify.server";
import db from "../db.server";

// Webhook di conformità obbligatori per lo Shopify App Store:
//   customers/data_request, customers/redact, shop/redact
// authenticate.webhook verifica la firma HMAC: con una firma non valida
// risponde 401 senza arrivare al codice sotto.
export const action = async ({ request }) => {
  const { topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  switch (String(topic).toUpperCase().replace("/", "_")) {
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      // L'app non salva dati dei clienti del negozio né dei visitatori:
      // non c'è nulla da esportare o cancellare.
      break;
    case "SHOP_REDACT":
      // 48 ore dopo la disinstallazione: elimina ogni dato rimasto del negozio.
      await db.session.deleteMany({ where: { shop } });
      break;
    default:
      break;
  }

  return new Response();
};
