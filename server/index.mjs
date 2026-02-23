import http from "node:http";
import fs from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const cwd = process.cwd();
const PUBLIC_DIR = path.join(cwd, "public");
const ENV = loadEnv(path.join(cwd, ".env"));
const PORT = Number(process.env.PORT || 3000);

function loadEnv(filePath){
  try{
    const raw = fs.readFileSync(filePath, "utf8");
    const out = {};
    for(const line of raw.split(/\r?\n/)){
      const trimmed = line.trim();
      if(!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if(idx < 0) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))){
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    return out;
  }catch{
    return {};
  }
}

function env(name){
  return process.env[name] || ENV[name] || "";
}

const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const PAYMONGO_SECRET_KEY = env("PAYMONGO_SECRET_KEY");
const PAYMONGO_WEBHOOK_SECRET = env("PAYMONGO_WEBHOOK_SECRET");
const APP_BASE_URL = (env("APP_BASE_URL") || `http://localhost:${PORT}`).replace(/\/$/, "");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function sendJson(res, status, body){
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendText(res, status, body, type="text/plain; charset=utf-8"){
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function readBody(req){
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if(body.length > 1_000_000){
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJson(req){
  const body = await readBody(req);
  return body ? JSON.parse(body) : {};
}

function supabaseHeaders(serviceRole = false, extra = {}){
  const key = serviceRole ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra
  };
}

async function supabaseRequest(pathname, { method="GET", body, serviceRole=false, headers={} } = {}){
  if(!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY){
    throw new Error("Missing Supabase env vars. Check .env (SUPABASE_URL / ANON / SERVICE_ROLE).");
  }

  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    method,
    headers: {
      ...supabaseHeaders(serviceRole, headers),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if(!res.ok){
    const msg = data?.message || data?.error || text || `Supabase error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function escapeCsvValues(values){
  return values.map(v => `"${String(v).replace(/"/g, "")}"`).join(",");
}

function toUiStatus(dbStatus){
  const map = {
    pending_payment: "Order Placed",
    order_placed: "Order Placed",
    preparing: "Preparing",
    in_transit: "In Transit",
    out_for_delivery: "Out for Delivery",
    delivered: "Delivered",
    cancelled: "Cancelled"
  };
  return map[dbStatus] || dbStatus || "Order Placed";
}

function toUiOrder(order, items = [], events = []){
  return {
    id: order.order_code,
    createdAt: order.created_at,
    customerName: order.customer_name,
    contact: order.contact,
    address: order.address,
    paymentMethod: order.payment_method || "QRPH",
    subtotal: Number(order.subtotal || 0),
    deliveryFee: Number(order.delivery_fee || 0),
    total: Number(order.total || 0),
    status: toUiStatus(order.status),
    items: items.map(it => ({
      productId: it.sku,
      name: it.name,
      price: Number(it.unit_price || 0),
      qty: Number(it.qty || 0),
      img: it.image_url || ""
    })),
    status_events: events
  };
}

function makeOrderCode(){
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `ORD-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${Math.floor(100 + Math.random()*900)}`;
}

function formatDate(value){
  if(!value) return "";
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function getProfileByEmail(email){
  const q = `/rest/v1/profiles?select=user_id,email,role&email=eq.${encodeURIComponent(email)}&limit=1`;
  const rows = await supabaseRequest(q, { serviceRole: true });
  return rows?.[0] || null;
}

async function getProfileFullByEmail(email){
  const q = `/rest/v1/profiles?select=user_id,email,role,full_name,contact,address,created_at,updated_at&email=eq.${encodeURIComponent(email)}&limit=1`;
  const rows = await supabaseRequest(q, { serviceRole: true });
  return rows?.[0] || null;
}

async function updateProfileByEmail(email, payload){
  const profile = await getProfileByEmail(email);
  if(!profile) throw new Error("Profile not found.");
  const patch = {};
  if("full_name" in payload) patch.full_name = payload.full_name;
  if("contact" in payload) patch.contact = payload.contact;
  if("address" in payload) patch.address = payload.address;
  if("email" in payload) patch.email = payload.email;
  const rows = await supabaseRequest(`/rest/v1/profiles?user_id=eq.${profile.user_id}`, {
    method: "PATCH",
    serviceRole: true,
    headers: { Prefer: "return=representation" },
    body: patch
  });
  return rows?.[0] || null;
}

async function getProductsBySkus(skus){
  if(!skus.length) return [];
  const inFilter = encodeURIComponent(`(${escapeCsvValues(skus)})`);
  const q = `/rest/v1/products?select=id,sku,name,category,unit,price,stock_cases,image_url,is_active&sku=in.${inFilter}`;
  return await supabaseRequest(q, { serviceRole: true });
}

async function listProducts(){
  const q = "/rest/v1/products?select=id,sku,name,category,unit,price,stock_cases,image_url,is_active&is_active=eq.true&order=name.asc";
  const rows = await supabaseRequest(q, { serviceRole: true });
  return rows.map(r => ({
    id: r.sku,
    dbId: r.id,
    sku: r.sku,
    name: r.name,
    category: r.category,
    unit: r.unit,
    price: Number(r.price),
    stockCases: Number(r.stock_cases),
    image_url: r.image_url || ""
  }));
}

async function listProfiles(){
  return await supabaseRequest("/rest/v1/profiles?select=user_id,email,role,full_name,contact,address,created_at", { serviceRole: true });
}

async function listAllOrdersRaw(){
  return await supabaseRequest("/rest/v1/orders?select=id,order_code,user_id,customer_name,contact,address,subtotal,delivery_fee,total,status,payment_status,payment_method,created_at&order=created_at.desc", { serviceRole: true });
}

async function listAllOrderItems(orderIds){
  if(!orderIds.length) return [];
  const inFilter = encodeURIComponent(`(${escapeCsvValues(orderIds)})`);
  return await supabaseRequest(`/rest/v1/order_items?select=order_id,sku,name,image_url,unit_price,qty,line_total,created_at&order_id=in.${inFilter}&order=created_at.asc`, { serviceRole: true });
}

async function listAllOrderEvents(orderIds){
  if(!orderIds.length) return [];
  const inFilter = encodeURIComponent(`(${escapeCsvValues(orderIds)})`);
  return await supabaseRequest(`/rest/v1/order_status_events?select=order_id,status,note,created_at&order_id=in.${inFilter}&order=created_at.asc`, { serviceRole: true });
}

async function listAllOrdersDetailed(){
  const [orders, profiles] = await Promise.all([listAllOrdersRaw(), listProfiles()]);
  if(!orders.length) return [];
  const orderIds = orders.map(o => o.id);
  const [items, events] = await Promise.all([
    listAllOrderItems(orderIds),
    listAllOrderEvents(orderIds)
  ]);
  const profileByUser = new Map(profiles.map(p => [p.user_id, p]));
  return orders.map(order => ({
    ...toUiOrder(
      order,
      items.filter(i => i.order_id === order.id),
      events.filter(e => e.order_id === order.id)
    ),
    userId: order.user_id,
    createdAtRaw: order.created_at,
    paymentStatus: order.payment_status,
    profile: profileByUser.get(order.user_id) || null
  }));
}

function computeRewardsForOrders(orders){
  const totalSpent = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const points = orders.reduce((sum, o) => sum + Math.floor(Number(o.total || 0) / 100) * 10, 0);
  return { totalSpent, points };
}

async function getRewardsByEmail(email){
  const orders = await listOrdersForEmail(email);
  return computeRewardsForOrders(orders);
}

async function getPanelDashboard(){
  const [orders, products] = await Promise.all([listAllOrdersDetailed(), listProducts()]);
  const recentOrders = orders.slice(0, 8);
  const totalSales = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const transactions = orders.length;
  const byProduct = new Map();
  for(const o of orders){
    for(const it of o.items || []){
      byProduct.set(it.name, (byProduct.get(it.name) || 0) + Number(it.qty || 0));
    }
  }
  let bestSeller = "-";
  let bestQty = 0;
  for(const [name, qty] of byProduct){
    if(qty > bestQty){ bestQty = qty; bestSeller = name; }
  }
  const lowStockCount = products.filter(p => Number(p.stockCases) > 0 && Number(p.stockCases) <= 10).length;
  const outOfStockCount = products.filter(p => Number(p.stockCases) <= 0).length;
  return {
    recentOrders,
    kpis: { totalSales, transactions, bestSeller, lowStockCount, outOfStockCount }
  };
}

async function getPanelCustomers(){
  const [profiles, orders] = await Promise.all([listProfiles(), listAllOrdersRaw()]);
  const byUser = new Map();
  for(const p of profiles){
    byUser.set(p.user_id, {
      name: p.full_name || p.email || "Unknown",
      email: p.email || "",
      totalOrders: 0,
      lastOrder: ""
    });
  }
  for(const o of orders){
    const rec = byUser.get(o.user_id) || {
      name: o.customer_name || "Unknown",
      email: "",
      totalOrders: 0,
      lastOrder: ""
    };
    rec.totalOrders += 1;
    rec.lastOrder = rec.lastOrder || formatDate(o.created_at);
    byUser.set(o.user_id, rec);
  }
  return [...byUser.values()].sort((a,b)=>b.totalOrders-a.totalOrders);
}

async function getPanelInventory(){
  const products = await listProducts();
  const inventory = products.map(p => ({
    ...p,
    status: Number(p.stockCases) <= 0 ? "Out of Stock" : Number(p.stockCases) <= 10 ? "Low Stock" : "In Stock"
  }));
  const lowStock = inventory.filter(p => p.status !== "In Stock").sort((a,b)=>a.stockCases-b.stockCases);
  return { inventory, lowStock };
}

async function getPanelSales(){
  const orders = await listAllOrdersDetailed();
  const byDate = new Map();
  const byWeek = new Map();
  const byMonth = new Map();
  const productQty = new Map();
  for(const o of orders){
    const d = new Date(o.createdAtRaw || o.createdAt);
    const dateKey = d.toISOString().slice(0,10);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const weekKey = weekStart.toISOString().slice(0,10);
    for(const [m, key] of [[byDate,dateKey],[byWeek,weekKey],[byMonth,monthKey]]){
      const rec = m.get(key) || { sales: 0, transactions: 0 };
      rec.sales += Number(o.total || 0);
      rec.transactions += 1;
      m.set(key, rec);
    }
    for(const it of o.items || []){
      productQty.set(it.name, (productQty.get(it.name) || 0) + Number(it.qty || 0));
    }
  }
  let bestSeller = "-";
  let bestQty = 0;
  for(const [name, qty] of productQty){
    if(qty > bestQty){ bestQty = qty; bestSeller = name; }
  }
  const latestDaily = [...byDate.entries()].sort((a,b)=>a[0] < b[0] ? 1 : -1)[0];
  const latestWeekly = [...byWeek.entries()].sort((a,b)=>a[0] < b[0] ? 1 : -1)[0];
  const latestMonthly = [...byMonth.entries()].sort((a,b)=>a[0] < b[0] ? 1 : -1)[0];
  return {
    kpis: {
      todaySales: latestDaily?.[1]?.sales || 0,
      transactions: latestDaily?.[1]?.transactions || 0,
      bestSeller,
      refunds: 0
    },
    rows: [
      { period: "Daily", sales: latestDaily?.[1]?.sales || 0, transactions: latestDaily?.[1]?.transactions || 0, bestSeller },
      { period: "Weekly", sales: latestWeekly?.[1]?.sales || 0, transactions: latestWeekly?.[1]?.transactions || 0, bestSeller },
      { period: "Monthly", sales: latestMonthly?.[1]?.sales || 0, transactions: latestMonthly?.[1]?.transactions || 0, bestSeller }
    ]
  };
}

async function getPanelReports(){
  const [orders, products] = await Promise.all([listAllOrdersDetailed(), listProducts()]);
  const delivered = orders.filter(o => o.status === "Delivered").length;
  const pending = orders.filter(o => o.status !== "Delivered" && o.status !== "Cancelled").length;
  const low = products.filter(p => Number(p.stockCases) > 0 && Number(p.stockCases) <= 10).length;
  const out = products.filter(p => Number(p.stockCases) <= 0).length;
  return [
    { reportType: "Sales Report", coverage: `${orders.length} orders total`, status: "Available" },
    { reportType: "Inventory Report", coverage: `${products.length} products (${low} low, ${out} out)`, status: "Available" },
    { reportType: "Top Selling Products", coverage: "Computed from order items", status: "Available" },
    { reportType: "Delivery Summary", coverage: `${delivered} delivered / ${pending} pending`, status: "Available" }
  ];
}

async function getPanelRewards(){
  const customers = await getPanelCustomers();
  const orders = await listAllOrdersDetailed();
  const byEmail = new Map();
  for(const c of customers){
    byEmail.set(c.email, { customer: c.name, email: c.email, points: 0, totalSpent: 0 });
  }
  for(const o of orders){
    const email = o.profile?.email || "";
    const rec = byEmail.get(email) || { customer: o.customerName, email, points: 0, totalSpent: 0 };
    rec.totalSpent += Number(o.total || 0);
    rec.points += Math.floor(Number(o.total || 0) / 100) * 10;
    byEmail.set(email, rec);
  }
  return [...byEmail.values()].sort((a,b)=>b.points-a.points);
}

async function getPanelDelivery(){
  const orders = await listAllOrdersDetailed();
  const active = orders.find(o => ["In Transit","Out for Delivery","Preparing","Order Placed"].includes(o.status)) || orders[0] || null;
  return { activeOrder: active };
}

async function supabasePasswordLogin(email, password){
  if(!SUPABASE_URL || !SUPABASE_ANON_KEY){
    throw new Error("Missing Supabase frontend keys in .env");
  }
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if(!res.ok){
    throw new Error(data?.msg || data?.error_description || data?.error || "Login failed");
  }
  return data;
}

async function supabaseAuthUser(accessToken){
  if(!SUPABASE_URL || !SUPABASE_ANON_KEY){
    throw new Error("Missing Supabase frontend keys in .env");
  }
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`
    }
  });
  const data = await res.json();
  if(!res.ok){
    throw new Error(data?.msg || data?.error_description || data?.error || "Invalid token");
  }
  return data;
}

function getBearerToken(req){
  const header = req.headers.authorization || "";
  if(!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
}

async function getProfileByUserId(userId){
  const q = `/rest/v1/profiles?select=user_id,email,role,full_name,contact,address,created_at,updated_at&user_id=eq.${encodeURIComponent(userId)}&limit=1`;
  const rows = await supabaseRequest(q, { serviceRole: true });
  return rows?.[0] || null;
}

async function requireAuth(req, allowedRoles = []){
  const token = getBearerToken(req);
  if(!token){
    const err = new Error("Missing bearer token");
    err.status = 401;
    throw err;
  }
  const authUser = await supabaseAuthUser(token);
  const profile = await getProfileByUserId(authUser.id);
  if(!profile){
    const err = new Error("Profile not found");
    err.status = 403;
    throw err;
  }
  if(allowedRoles.length && !allowedRoles.includes(profile.role)){
    const err = new Error("Forbidden");
    err.status = 403;
    throw err;
  }
  return { authUser, profile, token };
}

function toCentavos(amount){
  return Math.round(Number(amount || 0) * 100);
}

function isQrphMethod(method){
  return String(method || "").toUpperCase().includes("QRPH");
}

function paymongoAuthHeader(){
  if(!PAYMONGO_SECRET_KEY || PAYMONGO_SECRET_KEY.includes("...")){
    throw new Error("PayMongo secret key is missing or placeholder.");
  }
  return "Basic " + Buffer.from(`${PAYMONGO_SECRET_KEY}:`).toString("base64");
}

async function paymongoCreateCheckoutSession({ orderCode, lineItems, successUrl, cancelUrl }){
  const payload = {
    data: {
      attributes: {
        payment_method_types: ["qrph"],
        line_items: lineItems,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { order_code: orderCode }
      }
    }
  };
  const res = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: paymongoAuthHeader()
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if(!res.ok){
    throw new Error(data?.errors?.[0]?.detail || data?.error || "Failed to create PayMongo checkout session");
  }
  return data?.data || null;
}

function parsePaymongoSignature(headerValue){
  const out = {};
  for(const part of String(headerValue || "").split(",")){
    const [k, v] = part.split("=");
    if(k && v) out[k.trim()] = v.trim();
  }
  return out;
}

function verifyPaymongoWebhookSignature(rawBody, headerValue){
  if(!PAYMONGO_WEBHOOK_SECRET || PAYMONGO_WEBHOOK_SECRET.includes("...")){
    const err = new Error("PayMongo webhook secret not configured.");
    err.status = 500;
    throw err;
  }
  const sig = parsePaymongoSignature(headerValue);
  const timestamp = sig.t || "";
  const candidates = [sig.te, sig.li].filter(Boolean);
  if(!timestamp || !candidates.length) return false;
  const signed = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", PAYMONGO_WEBHOOK_SECRET).update(signed).digest("hex");
  return candidates.some((c) => c === expected);
}

async function listOrdersForEmail(email){
  const profile = await getProfileByEmail(email);
  if(!profile) return [];
  return listOrdersForUserId(profile.user_id);
}

async function listOrdersForUserId(userId){
  if(!userId) return [];

  const orders = await supabaseRequest(
    `/rest/v1/orders?select=id,order_code,user_id,customer_name,contact,address,subtotal,delivery_fee,total,status,payment_status,payment_method,created_at&user_id=eq.${userId}&order=created_at.desc`,
    { serviceRole: true }
  );
  if(!orders.length) return [];

  const orderIds = orders.map(o => o.id);
  const inFilter = encodeURIComponent(`(${escapeCsvValues(orderIds)})`);
  const [items, events] = await Promise.all([
    supabaseRequest(`/rest/v1/order_items?select=order_id,sku,name,image_url,unit_price,qty&order_id=in.${inFilter}&order=created_at.asc`, { serviceRole: true }),
    supabaseRequest(`/rest/v1/order_status_events?select=order_id,status,note,created_at&order_id=in.${inFilter}&order=created_at.asc`, { serviceRole: true })
  ]);

  return orders.map(order =>
    toUiOrder(
      order,
      items.filter(i => i.order_id === order.id),
      events.filter(e => e.order_id === order.id)
    )
  );
}

async function getOrderForEmail(orderCode, email){
  const orders = await listOrdersForEmail(email);
  return orders.find(o => o.id === orderCode) || null;
}

async function getOrderForUserId(orderCode, userId){
  const orders = await listOrdersForUserId(userId);
  return orders.find(o => o.id === orderCode) || null;
}

function uiStatusToDbStatus(status){
  const map = {
    "Order Placed": "order_placed",
    "Preparing": "preparing",
    "In Transit": "in_transit",
    "Out for Delivery": "out_for_delivery",
    "Delivered": "delivered",
    "Cancelled": "cancelled",
    pending_payment: "pending_payment",
    order_placed: "order_placed",
    preparing: "preparing",
    in_transit: "in_transit",
    out_for_delivery: "out_for_delivery",
    delivered: "delivered",
    cancelled: "cancelled"
  };
  return map[String(status || "").trim()] || "";
}

async function createOrder(payload, authProfile){
  const customerName = String(payload.customerName || "").trim();
  const contact = String(payload.contact || "").trim();
  const address = String(payload.address || "").trim();
  const paymentMethod = String(payload.paymentMethod || "QRPH").trim();
  const items = Array.isArray(payload.items) ? payload.items : [];

  if(!authProfile?.user_id || !customerName || !contact || !address || !items.length){
    throw new Error("Missing required order fields.");
  }

  const skuQty = new Map();
  for(const item of items){
    const sku = String(item.productId || "").trim();
    const qty = Number(item.qty || 0);
    if(!sku || qty <= 0) throw new Error("Invalid order item.");
    skuQty.set(sku, (skuQty.get(sku) || 0) + qty);
  }

  const products = await getProductsBySkus([...skuQty.keys()]);
  if(products.length !== skuQty.size){
    throw new Error("Some products were not found in Supabase.");
  }

  const productBySku = new Map(products.map(p => [p.sku, p]));
  const itemRows = [];
  let subtotal = 0;
  for(const [sku, qty] of skuQty.entries()){
    const p = productBySku.get(sku);
    if(!p || !p.is_active) throw new Error(`${sku} is inactive.`);
    if(Number(p.stock_cases) < qty) throw new Error(`${p.name} has insufficient stock.`);
    const unitPrice = Number(p.price);
    const lineTotal = unitPrice * qty;
    subtotal += lineTotal;
    itemRows.push({
      product_id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      unit: p.unit,
      image_url: p.image_url,
      unit_price: unitPrice,
      qty,
      line_total: lineTotal
    });
  }

  const deliveryFee = subtotal >= 800 ? 0 : 60;
  const total = subtotal + deliveryFee;
  const orderCode = makeOrderCode();

  const useQrph = isQrphMethod(paymentMethod);
  const inserted = await supabaseRequest("/rest/v1/orders", {
    method: "POST",
    serviceRole: true,
    headers: { Prefer: "return=representation" },
    body: [{
      order_code: orderCode,
      user_id: authProfile.user_id,
      customer_name: customerName,
      contact,
      address,
      subtotal,
      delivery_fee: deliveryFee,
      total,
      status: useQrph ? "pending_payment" : "order_placed",
      payment_status: useQrph ? "pending" : "pending",
      payment_provider: useQrph ? "paymongo" : null,
      payment_method: paymentMethod
    }]
  });

  const order = inserted[0];

  await supabaseRequest("/rest/v1/order_items", {
    method: "POST",
    serviceRole: true,
    headers: { Prefer: "return=minimal" },
    body: itemRows.map(row => ({ ...row, order_id: order.id }))
  });

  await supabaseRequest("/rest/v1/order_status_events", {
    method: "POST",
    serviceRole: true,
    headers: { Prefer: "return=minimal" },
    body: [{
      order_id: order.id,
      status: useQrph ? "pending_payment" : "order_placed",
      note: useQrph ? "Order created. Awaiting QRPH payment." : "Order created from web checkout."
    }]
  });

  await supabaseRequest("/rest/v1/payments", {
    method: "POST",
    serviceRole: true,
    headers: { Prefer: "return=minimal" },
    body: [{ order_id: order.id, provider: "paymongo", status: "pending", amount: total, currency: "PHP" }]
  });

  let checkoutUrl = null;
  if(useQrph){
    const checkout = await paymongoCreateCheckoutSession({
      orderCode: order.order_code,
      lineItems: itemRows.map((it) => ({
        currency: "PHP",
        amount: toCentavos(it.unit_price),
        name: it.name,
        quantity: it.qty
      })),
      successUrl: `${APP_BASE_URL}/customer/customer-orders.html?paid=${encodeURIComponent(order.order_code)}`,
      cancelUrl: `${APP_BASE_URL}/customer/customer-cart.html?cancelled=${encodeURIComponent(order.order_code)}`
    });
    checkoutUrl = checkout?.attributes?.checkout_url || null;
    const checkoutSessionId = checkout?.id || null;
    if(checkoutSessionId){
      await supabaseRequest(`/rest/v1/orders?order_code=eq.${encodeURIComponent(order.order_code)}`, {
        method: "PATCH",
        serviceRole: true,
        headers: { Prefer: "return=minimal" },
        body: [{ paymongo_checkout_session_id: checkoutSessionId }]
      });
      await supabaseRequest(`/rest/v1/payments?order_id=eq.${order.id}`, {
        method: "PATCH",
        serviceRole: true,
        headers: { Prefer: "return=minimal" },
        body: [{ provider_checkout_session_id: checkoutSessionId }]
      });
    }
  }

  const uiOrder = await getOrderForUserId(order.order_code, authProfile.user_id);
  return { order: uiOrder, checkoutUrl };
}

async function updateOrderStatus(orderCode, nextStatusInput, actorProfile){
  const nextStatus = uiStatusToDbStatus(nextStatusInput);
  if(!nextStatus){
    throw new Error("Invalid status.");
  }
  const rows = await supabaseRequest(`/rest/v1/orders?select=id,order_code,status,payment_status,payment_method,user_id&order_code=eq.${encodeURIComponent(orderCode)}&limit=1`, {
    serviceRole: true
  });
  const order = rows?.[0];
  if(!order) throw new Error("Order not found.");

  const unpaidQrph =
    isQrphMethod(order.payment_method) &&
    String(order.payment_status || "").toLowerCase() !== "paid";
  const allowedBeforePayment = new Set(["pending_payment", "cancelled"]);
  if(unpaidQrph && !allowedBeforePayment.has(nextStatus)){
    const err = new Error("Cannot move QRPH order status until payment is marked paid.");
    err.status = 409;
    throw err;
  }

  const updatedRows = await supabaseRequest(`/rest/v1/orders?order_code=eq.${encodeURIComponent(orderCode)}`, {
    method: "PATCH",
    serviceRole: true,
    headers: { Prefer: "return=representation" },
    body: [{ status: nextStatus }]
  });
  const updated = updatedRows?.[0];
  await supabaseRequest("/rest/v1/order_status_events", {
    method: "POST",
    serviceRole: true,
    headers: { Prefer: "return=minimal" },
    body: [{
      order_id: order.id,
      status: nextStatus,
      note: `Status updated to ${toUiStatus(nextStatus)} by ${actorProfile.role}.`,
      changed_by: actorProfile.user_id
    }]
  });
  return updated;
}

async function findOrderByCode(orderCode){
  const rows = await supabaseRequest(`/rest/v1/orders?select=id,order_code,user_id,status,payment_status,paymongo_checkout_session_id&order_code=eq.${encodeURIComponent(orderCode)}&limit=1`, {
    serviceRole: true
  });
  return rows?.[0] || null;
}

async function findOrderByCheckoutSessionId(checkoutSessionId){
  if(!checkoutSessionId) return null;
  const rows = await supabaseRequest(`/rest/v1/orders?select=id,order_code,user_id,status,payment_status,paymongo_checkout_session_id&paymongo_checkout_session_id=eq.${encodeURIComponent(checkoutSessionId)}&limit=1`, {
    serviceRole: true
  });
  return rows?.[0] || null;
}

async function hasOrderStatusEventNote(orderId, note){
  const rows = await supabaseRequest(
    `/rest/v1/order_status_events?select=id&order_id=eq.${orderId}&note=eq.${encodeURIComponent(note)}&limit=1`,
    { serviceRole: true }
  );
  return Boolean(rows?.length);
}

async function deductStockForOrder(orderId){
  const items = await supabaseRequest(
    `/rest/v1/order_items?select=product_id,qty,name&order_id=eq.${orderId}`,
    { serviceRole: true }
  );
  const validItems = (items || []).filter(i => i.product_id && Number(i.qty || 0) > 0);
  for(const item of validItems){
    const productRows = await supabaseRequest(
      `/rest/v1/products?select=id,name,stock_cases&id=eq.${item.product_id}&limit=1`,
      { serviceRole: true }
    );
    const product = productRows?.[0];
    if(!product) continue;
    const current = Number(product.stock_cases || 0);
    const next = Math.max(0, current - Number(item.qty || 0));
    await supabaseRequest(`/rest/v1/products?id=eq.${product.id}`, {
      method: "PATCH",
      serviceRole: true,
      headers: { Prefer: "return=minimal" },
      body: [{ stock_cases: next }]
    });
  }
}

async function markOrderPaidFromWebhook({ orderCode, checkoutSessionId, paymentId, eventId, rawPayload }){
  const STOCK_MARKER_NOTE = "QRPH payment confirmed via PayMongo webhook. Stock deducted.";
  const existingEvent = await supabaseRequest(`/rest/v1/payments?select=id&provider_event_id=eq.${encodeURIComponent(eventId)}&limit=1`, {
    serviceRole: true
  });
  if(existingEvent?.length){
    return { duplicate: true };
  }

  const order = (orderCode ? await findOrderByCode(orderCode) : null) || await findOrderByCheckoutSessionId(checkoutSessionId);
  if(!order) throw new Error("Order not found for webhook.");

  await supabaseRequest(`/rest/v1/orders?id=eq.${order.id}`, {
    method: "PATCH",
    serviceRole: true,
    headers: { Prefer: "return=minimal" },
    body: [{
      payment_status: "paid",
      status: "order_placed",
      paid_at: new Date().toISOString(),
      paymongo_checkout_session_id: checkoutSessionId || order.paymongo_checkout_session_id || null,
      paymongo_payment_id: paymentId || null
    }]
  });

  const stockAlreadyDeducted = await hasOrderStatusEventNote(order.id, STOCK_MARKER_NOTE);
  if(!stockAlreadyDeducted){
    await deductStockForOrder(order.id);
    console.log("[paymongo webhook] stock deducted for order", order.order_code);
    await supabaseRequest("/rest/v1/order_status_events", {
      method: "POST",
      serviceRole: true,
      headers: { Prefer: "return=minimal" },
      body: [{
        order_id: order.id,
        status: "order_placed",
        note: STOCK_MARKER_NOTE
      }]
    });
  }

  await supabaseRequest(`/rest/v1/payments?order_id=eq.${order.id}`, {
    method: "PATCH",
    serviceRole: true,
    headers: { Prefer: "return=minimal" },
    body: [{
      status: "paid",
      provider_event_id: eventId,
      provider_checkout_session_id: checkoutSessionId || null,
      provider_payment_id: paymentId || null,
      raw_payload: rawPayload
    }]
  });

  await supabaseRequest("/rest/v1/order_status_events", {
    method: "POST",
    serviceRole: true,
    headers: { Prefer: "return=minimal" },
    body: [{
      order_id: order.id,
      status: "order_placed",
      note: "QRPH payment confirmed via PayMongo webhook."
    }]
  });

  return { duplicate: false };
}

async function handleApi(req, res, url){
  if(req.method === "GET" && url.pathname === "/api/health"){
    sendJson(res, 200, { ok: true });
    return true;
  }

  if(req.method === "GET" && url.pathname === "/api/config"){
    sendJson(res, 200, {
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY
    });
    return true;
  }

  if(req.method === "POST" && url.pathname === "/api/paymongo/webhook"){
    const rawBody = await readBody(req);
    const signature = req.headers["paymongo-signature"] || req.headers["Paymongo-Signature"];
    if(!verifyPaymongoWebhookSignature(rawBody, signature)){
      console.warn("[paymongo webhook] invalid signature");
      sendJson(res, 401, { error: "Invalid PayMongo signature" });
      return true;
    }
    const event = rawBody ? JSON.parse(rawBody) : {};
    const eventId = event?.data?.id || event?.id || "";
    const eventType = event?.data?.attributes?.type || event?.type || "";
    const resource = event?.data?.attributes?.data || event?.data?.attributes?.resource || event?.resource || {};
    const resourceId = resource?.id || null;
    const resourceAttr = resource?.attributes || {};
    const metadata =
      resourceAttr?.metadata ||
      resourceAttr?.checkout_session?.metadata ||
      resourceAttr?.checkout?.metadata ||
      {};
    const orderCode = metadata?.order_code || null;
    const firstPayment =
      (Array.isArray(resourceAttr?.payments) && resourceAttr.payments[0]) ||
      (Array.isArray(resourceAttr?.payment_intent?.attributes?.payments) && resourceAttr.payment_intent.attributes.payments[0]) ||
      null;
    const paymentId = firstPayment?.id || firstPayment?.attributes?.id || null;

    console.log("[paymongo webhook] event", {
      eventId,
      eventType,
      resourceId,
      orderCode,
      paymentId
    });

    if(eventType === "checkout_session.payment.paid" || eventType === "payment.paid"){
      await markOrderPaidFromWebhook({
        orderCode,
        checkoutSessionId: resourceId,
        paymentId,
        eventId,
        rawPayload: event
      });
      console.log("[paymongo webhook] order marked paid");
    } else {
      console.log("[paymongo webhook] ignored event type", eventType);
    }

    sendJson(res, 200, { received: true });
    return true;
  }

  if(req.method === "POST" && url.pathname === "/api/auth/login"){
    const payload = await readJson(req);
    const email = String(payload.email || "").trim().toLowerCase();
    const password = String(payload.password || "");
    if(!email || !password){
      sendJson(res, 400, { error: "email and password are required" });
      return true;
    }
    const session = await supabasePasswordLogin(email, password);
    const profile = await getProfileFullByEmail(email);
    if(!profile){
      sendJson(res, 403, { error: "Profile not found for this user." });
      return true;
    }
    sendJson(res, 200, {
      user: {
        email: profile.email,
        role: profile.role,
        full_name: profile.full_name || ""
      },
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in
      }
    });
    return true;
  }

  if(req.method === "GET" && url.pathname === "/api/profile"){
    const { profile } = await requireAuth(req);
    sendJson(res, 200, { profile });
    return true;
  }

  if((req.method === "PUT" || req.method === "PATCH") && url.pathname === "/api/profile"){
    const auth = await requireAuth(req);
    const payload = await readJson(req);
    const profile = await updateProfileByEmail(auth.profile.email, {
      full_name: String(payload.fullName || payload.full_name || "").trim(),
      contact: String(payload.contact || "").trim(),
      address: String(payload.address || "").trim()
    });
    sendJson(res, 200, { profile });
    return true;
  }

  if(req.method === "GET" && url.pathname === "/api/rewards"){
    const auth = await requireAuth(req);
    const rewards = computeRewardsForOrders(await listOrdersForUserId(auth.profile.user_id));
    sendJson(res, 200, { rewards });
    return true;
  }

  if(req.method === "GET" && url.pathname === "/api/products"){
    const products = await listProducts();
    sendJson(res, 200, { products });
    return true;
  }

  if(req.method === "GET" && url.pathname === "/api/orders"){
    const auth = await requireAuth(req);
    const orders = await listOrdersForUserId(auth.profile.user_id);
    sendJson(res, 200, { orders });
    return true;
  }

  if(req.method === "GET" && url.pathname.startsWith("/api/orders/")){
    const auth = await requireAuth(req);
    const orderCode = decodeURIComponent(url.pathname.replace("/api/orders/", ""));
    const order = await getOrderForUserId(orderCode, auth.profile.user_id);
    if(!order){
      sendJson(res, 404, { error: "Order not found" });
      return true;
    }
    sendJson(res, 200, { order });
    return true;
  }

  if(req.method === "POST" && url.pathname === "/api/orders"){
    const auth = await requireAuth(req, ["customer", "admin", "staff"]);
    const payload = await readJson(req);
    const result = await createOrder(payload, auth.profile);
    sendJson(res, 201, result);
    return true;
  }

  if(req.method === "PATCH" && url.pathname.startsWith("/api/orders/") && url.pathname.endsWith("/status")){
    const auth = await requireAuth(req, ["admin", "staff"]);
    const orderCode = decodeURIComponent(url.pathname.replace("/api/orders/", "").replace("/status", ""));
    const payload = await readJson(req);
    await updateOrderStatus(orderCode, payload.status, auth.profile);
    const refreshed = await getOrderForUserId(orderCode, (await supabaseRequest(`/rest/v1/orders?select=user_id&order_code=eq.${encodeURIComponent(orderCode)}&limit=1`, { serviceRole: true }))?.[0]?.user_id);
    sendJson(res, 200, { ok: true, order: refreshed });
    return true;
  }

  if(req.method === "GET" && url.pathname === "/api/panel/admin/dashboard"){
    await requireAuth(req, ["admin"]);
    sendJson(res, 200, await getPanelDashboard());
    return true;
  }
  if(req.method === "GET" && url.pathname === "/api/panel/admin/orders"){
    await requireAuth(req, ["admin"]);
    sendJson(res, 200, { orders: await listAllOrdersDetailed() });
    return true;
  }
  if(req.method === "GET" && url.pathname === "/api/panel/admin/inventory"){
    await requireAuth(req, ["admin"]);
    sendJson(res, 200, await getPanelInventory());
    return true;
  }
  if(req.method === "GET" && url.pathname === "/api/panel/admin/customers"){
    await requireAuth(req, ["admin"]);
    sendJson(res, 200, { customers: await getPanelCustomers() });
    return true;
  }
  if(req.method === "GET" && url.pathname === "/api/panel/admin/reports"){
    await requireAuth(req, ["admin"]);
    sendJson(res, 200, { reports: await getPanelReports() });
    return true;
  }
  if(req.method === "GET" && url.pathname === "/api/panel/admin/rewards"){
    await requireAuth(req, ["admin"]);
    sendJson(res, 200, { rewards: await getPanelRewards() });
    return true;
  }
  if(req.method === "GET" && url.pathname === "/api/panel/admin/sales"){
    await requireAuth(req, ["admin"]);
    sendJson(res, 200, await getPanelSales());
    return true;
  }
  if(req.method === "GET" && (url.pathname === "/api/panel/admin/delivery" || url.pathname === "/api/panel/staff/delivery")){
    if(url.pathname.includes("/admin/")) await requireAuth(req, ["admin"]);
    else await requireAuth(req, ["staff", "admin"]);
    sendJson(res, 200, await getPanelDelivery());
    return true;
  }
  if(req.method === "GET" && url.pathname === "/api/panel/staff/orders"){
    await requireAuth(req, ["staff", "admin"]);
    const orders = await listAllOrdersDetailed();
    sendJson(res, 200, { orders });
    return true;
  }
  if(req.method === "GET" && url.pathname === "/api/panel/staff/inventory"){
    await requireAuth(req, ["staff", "admin"]);
    sendJson(res, 200, await getPanelInventory());
    return true;
  }

  return false;
}

async function serveStatic(res, url){
  let pathname = decodeURIComponent(url.pathname);
  if(pathname === "/") pathname = "/index.html";

  let filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if(!filePath.startsWith(PUBLIC_DIR)){
    sendText(res, 403, "Forbidden");
    return;
  }

  try{
    const info = await stat(filePath);
    if(info.isDirectory()){
      filePath = path.join(filePath, "index.html");
    }
  }catch(_e){}

  try{
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  }catch(_e){
    sendText(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try{
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const handled = await handleApi(req, res, url);
    if(handled) return;
    await serveStatic(res, url);
  }catch(err){
    console.error(err);
    sendJson(res, Number(err.status || 500), { error: err.message || "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Jazjo server running at http://localhost:${PORT}`);
});
