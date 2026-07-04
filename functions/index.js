const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const storage = admin.storage().bucket();
const TEAM_EMAIL = "trenton@sweethometransitions.com";
const DEFAULT_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS || 7000);

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function bearerToken(req) {
  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  return authHeader.slice(7).trim();
}

function providerConfigs() {
  return [
    {
      name: "zillow",
      endpoint: process.env.ZILLOW_PROVIDER_URL || "",
      apiKey: process.env.ZILLOW_API_KEY || "",
      sourceLabel: "Zillow"
    },
    {
      name: "realtor",
      endpoint: process.env.REALTOR_PROVIDER_URL || "",
      apiKey: process.env.REALTOR_API_KEY || "",
      sourceLabel: "Realtor"
    },
    {
      name: "homes",
      endpoint: process.env.HOMES_PROVIDER_URL || "",
      apiKey: process.env.HOMES_API_KEY || "",
      sourceLabel: "Homes.com"
    },
    {
      name: "county",
      endpoint: process.env.COUNTY_PROVIDER_URL || "",
      apiKey: process.env.COUNTY_PROVIDER_API_KEY || "",
      sourceLabel: "County Records"
    }
  ].filter((p) => p.endpoint);
}

function parseIsoDate(value) {
  const dt = new Date(value || 0);
  const time = dt.getTime();
  return Number.isFinite(time) ? time : 0;
}

function pickImageUrl(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (payload.floorPlanUrl) return String(payload.floorPlanUrl);
  if (payload.imageUrl) return String(payload.imageUrl);
  if (Array.isArray(payload.images) && payload.images.length) {
    return String(payload.images[0]);
  }
  if (payload.floorPlan && payload.floorPlan.url) {
    return String(payload.floorPlan.url);
  }
  return "";
}

function normalizeProviderResult(provider, payload) {
  const floorPlanUrl = pickImageUrl(payload);
  if (!floorPlanUrl) return null;

  const dimensions = payload?.dimensions || payload?.floorPlanDimensions || {};
  const widthFt = Number(dimensions.widthFt || payload?.widthFt || 0);
  const lengthFt = Number(dimensions.lengthFt || payload?.lengthFt || 0);
  const sqft = Number(dimensions.sqft || payload?.sqft || 0);
  const updatedAt = payload?.updatedAt || payload?.lastUpdatedAt || payload?.lastSeenAt || null;
  const sourceUrl = payload?.sourceUrl || payload?.listingUrl || payload?.url || provider.endpoint;

  return {
    provider: provider.name,
    source: provider.sourceLabel,
    sourceUrl: String(sourceUrl || ""),
    floorPlanUrl: String(floorPlanUrl),
    dimensions: {
      widthFt: Number.isFinite(widthFt) ? widthFt : 0,
      lengthFt: Number.isFinite(lengthFt) ? lengthFt : 0,
      sqft: Number.isFinite(sqft) ? sqft : 0
    },
    updatedAt: parseIsoDate(updatedAt),
    rawUpdatedAt: updatedAt || null
  };
}

async function callProvider(provider, address) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const headers = { "Content-Type": "application/json" };
    if (provider.apiKey) headers["x-api-key"] = provider.apiKey;

    const resp = await fetch(provider.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ address }),
      signal: ctrl.signal
    });
    if (!resp.ok) {
      throw new Error(`Provider ${provider.name} failed: ${resp.status}`);
    }

    const data = await resp.json();
    const normalized = normalizeProviderResult(provider, data);
    if (!normalized) {
      throw new Error(`Provider ${provider.name} returned no floor plan URL`);
    }
    return normalized;
  } finally {
    clearTimeout(timeout);
  }
}

function scoreCandidate(candidate) {
  const hasDims = candidate.dimensions?.sqft > 0 || (candidate.dimensions?.widthFt > 0 && candidate.dimensions?.lengthFt > 0);
  const freshness = candidate.updatedAt || 0;
  return freshness + (hasDims ? 1 : 0);
}

function extensionFromContentType(contentType) {
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  return "jpg";
}

async function storeFloorPlanImage(projectId, remoteImageUrl) {
  const resp = await fetch(remoteImageUrl);
  if (!resp.ok) {
    throw new Error(`Unable to download floor plan image (${resp.status})`);
  }
  const contentType = resp.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) {
    throw new Error("Provider did not return an image floor plan");
  }
  const bytes = Buffer.from(await resp.arrayBuffer());
  const ext = extensionFromContentType(contentType);
  const path = `floorplans/${projectId}/imported-${Date.now()}.${ext}`;
  const file = storage.file(path);
  await file.save(bytes, {
    contentType,
    resumable: false,
    metadata: {
      cacheControl: "public,max-age=3600"
    }
  });
  const [signedUrl] = await file.getSignedUrl({
    action: "read",
    expires: "2100-01-01"
  });
  return { signedUrl, storagePath: path };
}

async function assertTeamUser(decodedToken) {
  const email = String(decodedToken?.email || "").toLowerCase();
  if (email === TEAM_EMAIL) return;
  if (decodedToken?.team === true) return;
  const userDoc = await db.doc(`users/${decodedToken.uid}`).get();
  if (userDoc.exists && userDoc.data()?.role === "team") return;
  throw new Error("Not authorized for team floor plan lookup");
}

exports.floorPlanLookup = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 120,
    memory: "512MiB"
  },
  async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const token = bearerToken(req);
      if (!token) {
        res.status(401).json({ error: "Missing Bearer token" });
        return;
      }
      const decoded = await admin.auth().verifyIdToken(token);
      await assertTeamUser(decoded);

      const address = String(req.body?.address || "").trim();
      const projectId = String(req.body?.projectId || "").trim();
      if (!address || !projectId) {
        res.status(400).json({ error: "Both address and projectId are required" });
        return;
      }

      const providers = providerConfigs();
      if (!providers.length) {
        res.status(500).json({
          error: "No provider endpoints configured. Set ZILLOW_PROVIDER_URL, REALTOR_PROVIDER_URL, HOMES_PROVIDER_URL, or COUNTY_PROVIDER_URL in function env."
        });
        return;
      }

      const providerRuns = await Promise.allSettled(
        providers.map((provider) => callProvider(provider, address))
      );

      const successes = providerRuns
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value);

      if (!successes.length) {
        const errors = providerRuns
          .filter((r) => r.status === "rejected")
          .map((r) => String(r.reason?.message || r.reason));
        res.status(404).json({
          error: "No floor plan found from configured providers",
          providerErrors: errors
        });
        return;
      }

      const winner = [...successes].sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0];
      const stored = await storeFloorPlanImage(projectId, winner.floorPlanUrl);

      const payload = {
        clientAddress: address,
        floorPlanUrl: stored.signedUrl,
        floorPlanStoragePath: stored.storagePath,
        floorPlanDimensions: winner.dimensions,
        floorPlanSource: {
          name: winner.source,
          url: winner.sourceUrl,
          provider: winner.provider,
          importedAt: admin.firestore.FieldValue.serverTimestamp(),
          sourceUpdatedAt: winner.rawUpdatedAt || null
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await db.doc(`projects/${projectId}`).set(payload, { merge: true });

      res.status(200).json({
        floorPlanUrl: stored.signedUrl,
        dimensions: winner.dimensions,
        source: winner.source,
        sourceUrl: winner.sourceUrl,
        provider: winner.provider
      });
    } catch (error) {
      logger.error("floorPlanLookup failed", error);
      res.status(500).json({ error: error.message || "Unexpected floor plan lookup error" });
    }
  }
);
