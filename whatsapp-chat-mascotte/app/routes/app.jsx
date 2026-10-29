import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

// Prezzo gestito da Shopify: è l'app a dover mandare il merchant alla pagina
// dei piani quando non ha un abbonamento attivo. I negozi di sviluppo non si
// possono addebitare, quindi passano senza piano. Se il controllo fallisce
// (errore di rete o dell'API) l'accesso resta aperto: meglio non bloccare un
// merchant che paga per un problema temporaneo.
async function needsPlan(admin) {
  try {
    const res = await admin.graphql(
      `#graphql
        query BillingCheck {
          currentAppInstallation {
            app {
              handle
            }
            activeSubscriptions {
              id
            }
          }
          shop {
            plan {
              partnerDevelopment
            }
          }
        }`,
    );
    const data = (await res.json()).data;
    if (!data?.currentAppInstallation) return null;
    if (data.shop?.plan?.partnerDevelopment) return null;
    if (data.currentAppInstallation.activeSubscriptions?.length) return null;
    return data.currentAppInstallation.app?.handle || null;
  } catch (error) {
    console.error("Controllo abbonamento non riuscito:", error);
    return null;
  }
}

export const loader = async ({ request }) => {
  const { admin, session, redirect } = await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  if (process.env.SKIP_BILLING !== "1") {
    const handle = await needsPlan(admin);
    if (handle) {
      const store = session.shop.replace(".myshopify.com", "");
      return redirect(
        `https://admin.shopify.com/store/${store}/charges/${handle}/pricing_plans`,
        { target: "_top" },
      );
    }
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Impostazioni</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
