const { onRequest } = require("firebase-functions/v2/https");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const axios = require("axios");
const crypto = require("crypto");
const renderer = require("./renderer");
const Stripe = require("stripe");

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();
renderer && renderer.init && renderer.init(db);

// Define allowed origins for CORS
const corsOptions = {
  origin: [
    "https://desire-loja-final.web.app",
    "https://darkdesire.pt",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
  ],
  methods: ["POST", "GET"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// Initialize Stripe client on-demand within functions
let stripe;

/**
 * Helper: safe parse JSON
 */
function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

/**
 * Creates a Stripe Payment Intent.
 */
exports.createStripePaymentIntent = onRequest(
  { region: "europe-west3", secrets: ["STRIPE_SECRET_KEY"], cors: corsOptions },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    if (!stripe) {
      stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    }

    const { userId, cart } = req.body || {};

    if (!userId || !cart || !Array.isArray(cart) || cart.length === 0) {
      return res.status(400).send({ error: "Missing or invalid parameters: userId and cart are required." });
    }

    try {
      let amount = 0;
      for (const item of cart) {
        const productRef = db.collection("products").doc(item.id);
        const productDoc = await productRef.get();
        if (productDoc.exists) {
          amount += productDoc.data().price * item.quantity;
        }
      }
      const amountInCents = Math.round(amount * 100);

      if (amountInCents < 50) {
        return res.status(400).send({
          error: `Amount is too small. Minimum charge is €0.50. Amount calculated: €${amount.toFixed(2)}`,
        });
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: "eur",
        payment_method_types: ["card"],
        metadata: { userId },
      });

      const sessionRef = db.collection("stripe_sessions").doc(paymentIntent.id);
      await sessionRef.set({
        userId,
        cart,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.status(200).send({ clientSecret: paymentIntent.client_secret });
    } catch (error) {
      logger.error("Stripe Payment Intent creation failed:", error);
      return res.status(500).send({ error: "Failed to create Stripe Payment Intent." });
    }
  }
);

/**
 * Fulfills an order by creating it in Firestore and updating stock.
 */
const fulfillOrder = async (paymentIntent) => {
  const sessionRef = db.collection("stripe_sessions").doc(paymentIntent.id);
  const sessionDoc = await sessionRef.get();

  if (!sessionDoc.exists) {
    logger.error(`Could not find session for payment intent: ${paymentIntent.id}`);
    return;
  }

  const { userId, cart } = sessionDoc.data();
  if (!userId || !cart || !Array.isArray(cart) || cart.length === 0) {
    logger.error("Invalid session data from payment intent:", paymentIntent.id);
    return;
  }

  const orderRef = db.collection("orders").doc();
  const userRef = db.collection("users").doc(userId);

  try {
    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) throw new Error(`User ${userId} not found.`);
      const userProfile = userDoc.data();

      const productRefs = cart.map((item) => db.collection("products").doc(item.id));
      const productDocs = await transaction.getAll(...productRefs);
      const fullCartItems = [];
      const productUpdates = [];

      for (let i = 0; i < cart.length; i++) {
        const productDoc = productDocs[i];
        if (!productDoc.exists) throw new Error(`Product with ID ${cart[i].id} not found.`);
        const productData = productDoc.data();
        const cartItem = cart[i];

        if (productData.stock < cartItem.quantity) throw new Error(`Stock insufficient for ${productData.name}.`);

        const newStock = productData.stock - cartItem.quantity;
        const newSoldCount = (productData.sold || 0) + cartItem.quantity;
        productUpdates.push({ ref: productDoc.ref, data: { stock: newStock, sold: newSoldCount } });

        fullCartItems.push({
          ...cartItem,
          name: productData.name,
          price: productData.price,
          image: (productData.images && productData.images[0]) || productData.image || "",
        });
      }

      const total = paymentIntent.amount / 100;
      const pointsToAward = Math.floor(total);
      const orderData = {
        userId: userId,
        items: fullCartItems,
        total: total,
        paymentIntentId: paymentIntent.id,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        shippingAddress: userProfile.address,
        status: "Em processamento",
      };
      transaction.set(orderRef, orderData);
      productUpdates.forEach((update) => transaction.update(update.ref, update.data));
      const newPoints = (userProfile.loyaltyPoints || 0) + pointsToAward;
      transaction.update(userRef, { loyaltyPoints: newPoints, cart: [] });
    });

    await sessionRef.delete();
    logger.info(`Successfully fulfilled order for Payment Intent: ${paymentIntent.id}`);
  } catch (error) {
    logger.error(`Error fulfilling order for Payment Intent ${paymentIntent.id}:`, error);
  }
};

/**
 * Handles webhook events from Stripe.
 * Note: Cloud Functions v2 may not provide the raw body exactly as Stripe expects for signature verification.
 * We attempt verification when possible; if signature verification fails we log details and return 400.
 */
exports.stripeWebhook = onRequest(
  { region: "europe-west3", secrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] },
  async (req, res) => {
    if (!stripe) {
      stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    }
    const whSec = process.env.STRIPE_WEBHOOK_SECRET;
    if (!whSec) {
      logger.error("Stripe webhook secret is not configured.");
      return res.status(500).send("Webhook secret not configured.");
    }

    try {
      // Best-effort: try to use rawBody if available. If not, reconstruct from the raw buffer.
      const signature = req.headers["stripe-signature"];
      let event;
      try {
        const raw = req.rawBody || (req.body && Buffer.from(JSON.stringify(req.body)));
        if (!raw) throw new Error("No raw body available for signature verification");
        event = stripe.webhooks.constructEvent(raw, signature, whSec);
      } catch (sigErr) {
        logger.error("Webhook signature verification failed:", sigErr.message);
        return res.status(400).send(`Webhook Error: ${sigErr.message}`);
      }

      switch (event.type) {
        case "payment_intent.succeeded":
          await fulfillOrder(event.data.object);
          break;
        case "payment_intent.payment_failed":
          logger.warn(`Payment failed: ${event.data.object.last_payment_error?.message}`);
          break;
        default:
          logger.log(`Unhandled event type ${event.type}`);
      }
      return res.status(200).send();
    } catch (err) {
      logger.error("Error handling Stripe webhook.", err);
      return res.status(500).send(`Webhook handling error: ${err.message}`);
    }
  }
);

/**
 * Redirects the user to the AliExpress authorization page.
 */
exports.aliexpressAuthRedirect = onRequest(
  { region: "europe-west3", secrets: ["ALIEXPRESS_APP_KEY"], cors: corsOptions },
  async (req, res) => {
    const { uid } = req.query;
    if (!uid) {
      return res.status(400).send("User ID (uid) is a required query parameter.");
    }

    const APP_KEY = process.env.ALIEXPRESS_APP_KEY ? process.env.ALIEXPRESS_APP_KEY.trim() : null;
    if (!APP_KEY) {
      logger.error("ALIEXPRESS_APP_KEY secret is not set.");
      return res.status(500).send("Application is not configured correctly.");
    }

    const REDIRECT_URI = "https://europe-west3-desire-loja-final.cloudfunctions.net/aliexpressAuthCallback";

    // Gera nonce único para este fluxo
    const nonce = crypto.randomBytes(16).toString("hex");
    const state = { uid, nonce };

    // Guarda o state identificado pelo nonce (não pelo uid)
    await db.collection("aliexpress_auth_states").doc(nonce).set({
      uid,
      nonce,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Codifica o state em base64 + encodeURIComponent
    const rawState = Buffer.from(JSON.stringify(state)).toString("base64");
    const encodedState = encodeURIComponent(rawState);
    const encodedRedirectUri = encodeURIComponent(REDIRECT_URI);

    // Usa o endpoint global recomendado
    const authorizationUrl =
      "https://api-sg.aliexpress.com/oauth/authorize" +
      `?response_type=code` +
      `&client_id=${APP_KEY}` +
      `&redirect_uri=${encodedRedirectUri}` +
      `&state=${encodedState}` +
      `&view=web`;

    logger.info(`Redirecting to AliExpress for authorization: ${authorizationUrl}`);
    return res.redirect(authorizationUrl);
  }
);

/**
 * Handles the callback from AliExpress after authorization.
 * Improved: robust state decoding, correct form-encoded token exchange and fallback handling.
 */
exports.aliexpressAuthCallback = onRequest(
  {
    region: "europe-west3",
    secrets: ["ALIEXPRESS_APP_KEY", "ALIEXPRESS_APP_SECRET"],
    cors: corsOptions,
  },
  async (req, res) => {
    const { code, state } = req.query || {};

    if (!code || !state) {
      return res.status(400).send("Error: Missing code or state from AliExpress callback.");
    }

    logger.info("AliExpress callback received", { code, state });

    try {
      // Decodifica o state (aceita que já venha decoded ou não)
      let stateStr = state;
      try {
        stateStr = decodeURIComponent(stateStr);
      } catch (e) {
        logger.debug("State decodeURIComponent threw, maybe already decoded");
      }

      const maybeJson = safeJsonParse(stateStr);
      let decodedState = null;
      if (maybeJson) {
        decodedState = maybeJson;
      } else {
        // assume base64
        try {
          decodedState = JSON.parse(Buffer.from(stateStr, "base64").toString("utf8"));
        } catch (e) {
          logger.error("Failed to decode state: must be JSON or base64(JSON)");
          return res.status(400).send("Invalid state format.");
        }
      }

      if (!decodedState || !decodedState.uid || !decodedState.nonce) {
        throw new Error("Invalid state format.");
      }

      // Verifica nonce no Firestore
      const stateRef = db.collection("aliexpress_auth_states").doc(decodedState.nonce);
      const stateDoc = await stateRef.get();

      if (!stateDoc.exists) {
        logger.error(`CSRF Warning: State document not found for nonce ${decodedState.nonce}.`);
        return res.status(403).send("Error: Invalid state. CSRF detected.");
      }

      const stored = stateDoc.data();
      if (stored.nonce !== decodedState.nonce || stored.uid !== decodedState.uid) {
        logger.error(`CSRF Warning: State mismatch. Stored: ${JSON.stringify(stored)}, Received: ${JSON.stringify(decodedState)}`);
        return res.status(403).send("Error: Invalid state. CSRF detected.");
      }

      // Estado validado, pode apagar o doc
      await stateRef.delete();

      // Pega os secrets
      const APP_KEY = process.env.ALIEXPRESS_APP_KEY?.trim();
      const APP_SECRET = process.env.ALIEXPRESS_APP_SECRET?.trim();
      if (!APP_KEY || !APP_SECRET) {
        logger.error("ALIEXPRESS secrets are not set.");
        return res.status(500).send("Application is not configured correctly.");
      }

      const REDIRECT_URI = "https://europe-west3-desire-loja-final.cloudfunctions.net/aliexpressAuthCallback";

      // Build parameters for /rest/auth/token/create (TOP protocol)
      const timestamp = Date.now().toString();
      const paramsMap = {
        app_key: APP_KEY,
        timestamp: timestamp,
        sign_method: "sha256",
        code: code,
      };

      // For /rest/auth/token/create, the signature includes the API name prepended
      const apiName = "/auth/token/create";
      const sortedKeys = Object.keys(paramsMap).sort();
      let signString = apiName;
      sortedKeys.forEach((key) => {
        signString += key + paramsMap[key];
      });

      const sign = crypto.createHmac("sha256", APP_SECRET).update(signString).digest("hex").toUpperCase();

      const params = new URLSearchParams({
        ...paramsMap,
        sign: sign,
        // Note: client_secret, grant_type, redirect_uri are NOT used in this endpoint,
        // but some docs suggest they might be for other OAuth endpoints.
        // For /rest/auth/token/create, we rely on TOP signature.
      });

      // Primary token endpoint used by many AliExpress docs
      const primaryTokenEndpoint = "https://api-sg.aliexpress.com/rest/auth/token/create";

      let tokenResponse;
      try {
        tokenResponse = await axios.post(primaryTokenEndpoint, params.toString(), {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 15000,
        });
      } catch (err) {
        logger.error("Token exchange failed:", err.response ? err.response.data : err.message);
        throw err;
      }

      const data = tokenResponse.data;

      // AliExpress may nest response or return key names differently. Try to pick common paths.
      const access_token = data.access_token || data.result?.access_token || data.data?.access_token;
      const refresh_token = data.refresh_token || data.result?.refresh_token || data.data?.refresh_token;
      const expire_time = data.expire_time || data.result?.expire_time || data.data?.expire_time || 0;
      const refresh_token_valid_time = data.refresh_token_valid_time || data.result?.refresh_token_valid_time || data.data?.refresh_token_valid_time || 0;
      const user_id = data.user_id || data.result?.user_id || data.data?.user_id;
      const user_nick = data.user_nick || data.result?.user_nick || data.data?.user_nick;

      if (!access_token) {
        logger.error("Token exchange returned no access token:", data);
        throw new Error("No access token returned from AliExpress.");
      }

      // Salva tokens no Firestore
      await db.collection("aliexpress_tokens").doc(decodedState.uid).set({
        accessToken: access_token,
        refreshToken: refresh_token,
        accessTokenExpiresAt: Date.now() + (Number(expire_time) || 0) * 1000,
        refreshTokenExpiresAt: Date.now() + (Number(refresh_token_valid_time) || 0) * 1000,
        aliExpressUserId: user_id,
        aliExpressUserNick: user_nick,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(`AliExpress tokens stored for user ${decodedState.uid}`);

      return res.status(200).send("<h1>Authentication successful!</h1><p>You can now close this window.</p>");
    } catch (error) {
      logger.error("Error during AliExpress auth callback:", error.response ? error.response.data : error.message);
      return res.status(500).send("An error occurred during authentication.");
    }
  }
);

/**
 * Callable function to import a product from AliExpress.
 */
exports.importAliExpressProduct = onCall(
  { region: "europe-west3", secrets: ["ALIEXPRESS_APP_KEY", "ALIEXPRESS_APP_SECRET"] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "The function must be called while authenticated.");

    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!userDoc.exists || !userDoc.data().isAdmin) throw new HttpsError("permission-denied", "You must be an admin.");

    const { productUrl } = request.data || {};
    if (!productUrl) throw new HttpsError("invalid-argument", 'Missing "productUrl" argument.');

    let productId;
    try {
      productId = new URL(productUrl).pathname.split("/")[2].replace(".html", "");
    } catch (error) {
      throw new HttpsError("invalid-argument", "Invalid AliExpress product URL.");
    }

    const tokenRef = db.collection("aliexpress_tokens").doc(request.auth.uid);
    const tokenDoc = await tokenRef.get();
    if (!tokenDoc.exists) throw new HttpsError("failed-precondition", "AliExpress account not connected.");

    let { accessToken, refreshToken, accessTokenExpiresAt } = tokenDoc.data();

    const APP_KEY = process.env.ALIEXPRESS_APP_KEY ? process.env.ALIEXPRESS_APP_KEY.trim() : null;
    const APP_SECRET = process.env.ALIEXPRESS_APP_SECRET ? process.env.ALIEXPRESS_APP_SECRET.trim() : null;
    if (!APP_KEY || !APP_SECRET) throw new HttpsError("internal", "API secrets are not configured.");

    // Refresh token se necessário
    if (!accessTokenExpiresAt || Date.now() >= accessTokenExpiresAt) {
      logger.info("Access token expired or missing, refreshing...");
      try {
        const params = new URLSearchParams({
          client_id: APP_KEY,
          client_secret: APP_SECRET,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        });

        const response = await axios.post("https://api-sg.aliexpress.com/rest/auth/token/refresh", params.toString(), {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });

        const rdata = response.data;
        const newAccess = rdata.access_token || rdata.result?.access_token || rdata.data?.access_token;
        if (newAccess) {
          accessToken = newAccess;
          await tokenRef.update({
            accessToken: accessToken,
            refreshToken: rdata.refresh_token || refreshToken,
            accessTokenExpiresAt: Date.now() + ((rdata.expire_time || rdata.result?.expire_time || 0) * 1000),
          });
          logger.info("Successfully refreshed access token.");
        } else {
          logger.error("Failed to refresh token:", rdata);
          throw new Error("Failed to refresh token");
        }
      } catch (error) {
        logger.error("Error refreshing AliExpress access token:", error.response ? error.response.data : error.message);
        throw new HttpsError("unknown", "Could not refresh the AliExpress session.");
      }
    }

    try {
      // Parameters for the request
      const params = {
        app_key: APP_KEY,
        sign_method: "sha256",
        timestamp: Date.now().toString(),
        method: "aliexpress.ds.product.get",
        product_id: productId,
        v: "2.0",
        format: "json",
      };

      // Parameters for signing (sign with 'session' to match TOP protocol)
      const signParams = {
        ...params,
        session: accessToken,
      };

      // Sort parameters and append to signString (No API name prepend for Router endpoint)
      const signString = Object.keys(signParams)
        .sort()
        .map((key) => `${key}${signParams[key]}`)
        .join("");

      const sign = crypto.createHmac("sha256", APP_SECRET).update(signString).digest("hex").toUpperCase();

      // Final query parameters
      const requestParams = {
        ...signParams,
        sign: sign,
      };

      // Log debug info
      const debugParams = { ...requestParams };
      if (debugParams.session) debugParams.session = "***";
      const debugSignString = signString.replace(accessToken, "***");
      logger.info("AliExpress Request Debug:", { debugParams, debugSignString });

      const response = await axios.get("https://api-sg.aliexpress.com/rest", { params: requestParams, timeout: 15000 });
      const result = response.data.aliexpress_ds_product_get_response?.result || response.data.result || response.data.data?.result;
      if (!result) {
        logger.error("Error fetching product from AliExpress:", response.data);
        throw new HttpsError("not-found", "Could not retrieve product details from AliExpress.");
      }

      const productData = {
        name: result.ae_item_base_info_dto?.subject || result.subject,
        description: result.ae_item_base_info_dto?.detail || result.detail,
      };

      return { success: true, product: productData };
    } catch (error) {
      logger.error("Error fetching AliExpress product:", error.response ? error.response.data : error.message);
      throw new HttpsError("unknown", "An error occurred while fetching product data.");
    }
  }
);

/**
 * Server-side rendering function.
 */
exports.ssr = onRequest({ region: "europe-west3" }, renderer.render);
