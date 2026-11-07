const { MongoClient } = require("mongodb");
const https = require("https");

const MONGO_URI = "mongodb+srv://admin:qwe098@cluster0.sw7tw.mongodb.net/mc_survival_hub?appName=Cluster0";
const PASS_KEY = "oiuweroiuweroiuweroiuwer";
let cachedToken = "";

let cachedClient = null;
const getDb = async () => {
  if (!cachedClient) {
    cachedClient = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await cachedClient.connect();
  }
  return cachedClient.db("mc_survival_hub");
};

const getToken = async db => {
  if (cachedToken) return cachedToken;
  const doc = await db.collection("hub_config").findOne({ key: "gh_token" });
  cachedToken = doc ? doc.val : "";
  return cachedToken;
};

const ghReq = (method, apiPath, token, bodyObj, isUploadUrl = false, rawBuf = null) => new Promise((resolve, reject) => {
  const payload = rawBuf || (bodyObj ? Buffer.from(JSON.stringify(bodyObj), "utf8") : null);
  const u = isUploadUrl ? new URL(apiPath) : { hostname: "api.github.com", pathname: apiPath, search: "" };
  const req = https.request({
    hostname: u.hostname,
    path: (u.pathname || "") + (u.search || ""),
    method,
    headers: {
      "User-Agent": "MC26-Hub",
      ...(token ? { "Authorization": "token " + token } : {}),
      "Accept": "application/vnd.github+json",
      ...(payload ? {
        "Content-Type": rawBuf ? "application/zip" : "application/json",
        "Content-Length": payload.length
      } : {})
    }
  }, res => {
    let out = "";
    res.on("data", c => { out += c; });
    res.on("end", () => {
      try {
        resolve({ status: res.statusCode, data: out ? JSON.parse(out) : {} });
      } catch (_) {
        resolve({ status: res.statusCode, data: out });
      }
    });
  });
  req.on("error", reject);
  if (payload) req.write(payload);
  req.end();
});

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-pass");
  if (req.method === "OPTIONS") return res.status(200).end();

  const pass = req.headers["x-pass"] || req.query.pass || (req.body && req.body.pass);
  if (pass !== PASS_KEY) {
    return res.status(401).json({ ok: false, error: "비밀번호 불일치" });
  }

  const action = req.query.action || (req.body && req.body.action) || "state";

  try {
    const db = await getDb();
    const token = await getToken(db);
    const notesCol = db.collection("calendar_notes");
    const deltasCol = db.collection("world_deltas");

    const handlers = {
      "state": async () => {
        const notesDocs = await notesCol.find({}).toArray();
        const notesMap = {};
        notesDocs.forEach(d => { notesMap[d.dateKey] = d.content; });
        const deltas = await deltasCol.find({}).sort({ timestamp: -1 }).limit(30).toArray();
        const ghHist = await ghReq("GET", "/repos/AppIemon/mc-hub/contents/delta_history.json?ref=world-BACAP_%EC%95%BC%EC%83%9D", token);
        let gitDeltas = [];
        if (ghHist.status === 200 && ghHist.data && ghHist.data.content) {
          try {
            gitDeltas = JSON.parse(Buffer.from(ghHist.data.content, "base64").toString("utf8"));
          } catch (_) {}
        }
        return res.status(200).json({
          ok: true,
          notes: notesMap,
          deltas,
          gitDeltas,
          downloads: {
            fullPack: "https://github.com/AppIemon/mc-hub/releases/download/v26.3-pcbang/PCBang_26_3_FullPack.zip",
            worldZip: "https://github.com/AppIemon/mc-hub/releases/download/v26.3-pcbang/BACAP_World_Latest.zip"
          }
        });
      },
      "save_note": async () => {
        const { dateKey, content } = req.body || {};
        if (!dateKey) return res.status(400).json({ ok: false, error: "dateKey 필요" });
        await notesCol.updateOne(
          { dateKey },
          { $set: { dateKey, content: String(content || ""), updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
        return res.status(200).json({ ok: true, dateKey });
      },
      "push_delta": async () => {
        const { day, trigger, changedFiles, statSummary, filesPayload, worldZipBase64 } = req.body || {};
        const now = new Date().toISOString().replace("T", " ").slice(0, 19);
        const entry = {
          day: Number(day || 0),
          trigger: String(trigger || "pcbang_sync"),
          changedFiles: Array.isArray(changedFiles) ? changedFiles : [],
          statSummary: String(statSummary || ""),
          timestamp: now
        };
        await deltasCol.insertOne(entry);

        if (token && Array.isArray(filesPayload) && filesPayload.length > 0) {
          for (const f of filesPayload.slice(0, 25)) {
            const safePath = String(f.path || "").replace(/^\/+/, "");
            if (!safePath) continue;
            const cur = await ghReq("GET", "/repos/AppIemon/mc-hub/contents/" + encodeURI(safePath) + "?ref=world-BACAP_%EC%95%BC%EC%83%9D", token);
            const sha = cur.status === 200 && cur.data ? cur.data.sha : undefined;
            await ghReq("PUT", "/repos/AppIemon/mc-hub/contents/" + encodeURI(safePath), token, {
              message: "[" + entry.trigger + "] Day " + entry.day + " - " + safePath,
              content: f.base64,
              branch: "world-BACAP_야생",
              ...(sha ? { sha } : {})
            });
          }
        }

        if (token && worldZipBase64) {
          const rel = await ghReq("GET", "/repos/AppIemon/mc-hub/releases/tags/v26.3-pcbang", token);
          if (rel.status === 200 && rel.data && rel.data.id) {
            const oldAsset = (rel.data.assets || []).find(a => a.name === "BACAP_World_Latest.zip");
            if (oldAsset) {
              await ghReq("DELETE", "/repos/AppIemon/mc-hub/releases/assets/" + oldAsset.id, token);
            }
            const cleanUrl = rel.data.upload_url.replace(/\{\?.*$/, "") + "?name=BACAP_World_Latest.zip";
            await ghReq("POST", cleanUrl, token, null, true, Buffer.from(worldZipBase64, "base64"));
          }
        }

        return res.status(200).json({ ok: true, entry });
      }
    };

    return await (handlers[action] || handlers["state"])();
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
