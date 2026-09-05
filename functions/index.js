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

function cleanText(value, maxLen) {
  const cleaned = String(value || "").trim();
  if (!maxLen) return cleaned;
  return cleaned.slice(0, maxLen);
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

const LISTING_FETCH_TIMEOUT_MS = Number(process.env.LISTING_TIMEOUT_MS || 10000);

// Facebook serves Open Graph metadata to link-preview crawlers. A normal browser
// user agent usually gets a login wall instead, so crawler agents are tried first.
const LISTING_USER_AGENTS = [
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
];

// Titles Facebook returns for login walls, checkpoints, and removed listings.
const REJECTED_TITLE_PATTERNS = [
  /^facebook$/i,
  /^marketplace$/i,
  /^log ?in( or sign ?up)?/i,
  /^sign ?up/i,
  /^security check/i,
  /^error$/i,
  /^page not found/i,
  /^content not found/i,
  /^this content isn'?t available/i,
  /^redirecting/i
];

function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    "#39": "'"
  };
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-z]+|#\d+);/gi, (match, entity) => named[entity.toLowerCase()] ?? match);
}

function metaContent(html, property) {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
    "i"
  );
  const reversed = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
    "i"
  );
  const match = html.match(pattern) || html.match(reversed);
  return match ? decodeHtmlEntities(match[1]).trim() : "";
}

// Marketplace URLs carry large tracking payloads; keep only the canonical item path.
function listingSourceForUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;

  const host = parsed.hostname.toLowerCase();
  const isFacebook =
    host === "facebook.com" ||
    host === "fb.com" ||
    host.endsWith(".facebook.com") ||
    host.endsWith(".fb.com");
  if (!isFacebook) return null;

  const itemId = parsed.pathname.match(/\/marketplace\/item\/(\d+)/)?.[1];
  const canonicalUrl = itemId
    ? `https://www.facebook.com/marketplace/item/${itemId}/`
    : `https://www.facebook.com${parsed.pathname}`;

  return { source: "Facebook Marketplace", url: canonicalUrl, itemId: itemId || "" };
}

function cleanListingTitle(rawTitle) {
  let title = decodeHtmlEntities(rawTitle).replace(/\s+/g, " ").trim();
  if (!title) return "";

  title = title.replace(/\s*[-|·]\s*(Facebook\s*Marketplace|Marketplace|Facebook)\s*$/i, "");
  title = title.replace(/^\s*(Facebook\s*Marketplace|Marketplace)\s*[-|·:]\s*/i, "");
  title = title.trim();

  if (REJECTED_TITLE_PATTERNS.some((pattern) => pattern.test(title))) return "";
  if (title.length < 2) return "";

  return title.slice(0, 200);
}

// A Marketplace page embeds dozens of *other* listings that Facebook
// recommends alongside the one that was requested, and their order changes
// between requests. Scanning the embedded JSON therefore returns an arbitrary
// neighbouring listing's price: the same URL measured twice produced $450 and
// then $100. Only the page-level price meta tags describe the requested
// listing, so anything else is left at zero for the team to enter by hand
// rather than importing a wrong consignment amount.
function parseListingPrice(html) {
  const candidates = [
    metaContent(html, "product:price:amount"),
    metaContent(html, "og:price:amount")
  ];

  for (const candidate of candidates) {
    const amount = Number(String(candidate || "").replace(/[^0-9.]/g, ""));
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return 0;
}

function extractListingTitle(html) {
  // Page-level tags only, for the same reason as parseListingPrice: the
  // embedded "marketplace_listing_title" values belong to the recommended
  // listings injected next to the real one, so reading them can silently name
  // an item after somebody else's listing.
  const rawCandidates = [
    metaContent(html, "og:title"),
    metaContent(html, "twitter:title"),
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""
  ];

  for (const candidate of rawCandidates) {
    const title = cleanListingTitle(candidate);
    if (title) return title;
  }
  return "";
}

async function fetchListingPage(url, userAgent) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), LISTING_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9"
      },
      signal: ctrl.signal
    });
    if (!resp.ok) {
      throw new Error(`Facebook returned ${resp.status}`);
    }
    return (await resp.text()).slice(0, 800000);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchListingDetails(target) {
  const errors = [];

  for (const userAgent of LISTING_USER_AGENTS) {
    let html;
    try {
      html = await fetchListingPage(target.url, userAgent);
    } catch (error) {
      errors.push(error.message);
      continue;
    }

    const title = extractListingTitle(html);
    if (!title) {
      errors.push("Facebook served a login wall instead of the listing");
      continue;
    }

    return {
      title,
      source: target.source,
      listingUrl: target.url,
      imageUrl: metaContent(html, "og:image"),
      amount: parseListingPrice(html)
    };
  }

  throw new Error(errors[0] || "Unable to read this Marketplace listing");
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
      const preserveManual = req.body?.preserveManual === true;
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
        floorPlanImported: {
          floorPlanUrl: stored.signedUrl,
          storagePath: stored.storagePath,
          dimensions: winner.dimensions,
          source: winner.source,
          sourceUrl: winner.sourceUrl,
          provider: winner.provider,
          importedAt: admin.firestore.FieldValue.serverTimestamp(),
          sourceUpdatedAt: winner.rawUpdatedAt || null
        },
        floorPlanImportedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      if (!preserveManual) {
        payload.floorPlanUrl = stored.signedUrl;
        payload.floorPlanStoragePath = stored.storagePath;
        payload.floorPlanDimensions = winner.dimensions;
        payload.floorPlanSource = {
          name: winner.source,
          url: winner.sourceUrl,
          provider: winner.provider,
          importedAt: admin.firestore.FieldValue.serverTimestamp(),
          sourceUpdatedAt: winner.rawUpdatedAt || null
        };
        payload.floorPlanManualOverride = false;
      }

      await db.doc(`projects/${projectId}`).set(payload, { merge: true });

      res.status(200).json({
        floorPlanUrl: stored.signedUrl,
        dimensions: winner.dimensions,
        source: winner.source,
        sourceUrl: winner.sourceUrl,
        provider: winner.provider,
        appliedToDisplay: !preserveManual
      });
    } catch (error) {
      logger.error("floorPlanLookup failed", error);
      res.status(500).json({ error: error.message || "Unexpected floor plan lookup error" });
    }
  }
);

exports.inquiryIntake = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB"
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
      const name = cleanText(req.body?.name, 120);
      const phone = cleanText(req.body?.phone, 40);
      const email = cleanText(req.body?.email, 120).toLowerCase();
      const service = cleanText(req.body?.service, 120) || "Free Consultation";
      const message = cleanText(req.body?.message, 3000);
      const submittedAt = cleanText(req.body?.submittedAt, 80);

      if (!name || !phone || !email) {
        res.status(400).json({ error: "name, phone, and email are required" });
        return;
      }

      await db.collection("projects").add({
        title: name,
        clientName: name,
        clientEmail: email,
        clientPhone: phone,
        inquiryService: service,
        inquiryMessage: message,
        inquirySubmittedAt: submittedAt || null,
        inquirySource: "website-contact-form",
        pipelineStage: "potential",
        pipelineProgress: 10,
        contractors: [],
        hoursAtHome: 0,
        floorPlanUrl: "",
        teamNotes: "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      res.status(200).json({ result: "ok" });
    } catch (error) {
      logger.error("inquiryIntake failed", error);
      res.status(500).json({ error: "Unable to save inquiry to pipeline" });
    }
  }
);

exports.listingLookup = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB"
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
        res.status(401).json({ error: "Missing ******" });
        return;
      }
      const decoded = await admin.auth().verifyIdToken(token);
      await assertTeamUser(decoded);

      const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
      const requested = urls.map((url) => String(url || "").trim()).filter(Boolean).slice(0, 25);
      if (!requested.length) {
        res.status(400).json({ error: "At least one listing URL is required" });
        return;
      }

      const results = await Promise.all(
        requested.map(async (rawUrl) => {
          const target = listingSourceForUrl(rawUrl);
          if (!target) {
            return {
              requestedUrl: rawUrl,
              ok: false,
              error: "Only https Facebook Marketplace listing URLs are supported"
            };
          }
          try {
            const details = await fetchListingDetails(target);
            return { requestedUrl: rawUrl, ok: true, ...details };
          } catch (error) {
            logger.warn("listingLookup item failed", { url: rawUrl, message: error.message });
            return {
              requestedUrl: rawUrl,
              ok: false,
              source: target.source,
              listingUrl: target.url,
              error: error.message || "Unable to read listing"
            };
          }
        })
      );

      res.status(200).json({ results });
    } catch (error) {
      logger.error("listingLookup failed", error);
      res.status(500).json({ error: error.message || "Unexpected listing lookup error" });
    }
  }
);
