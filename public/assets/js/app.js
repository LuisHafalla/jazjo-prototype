/* Jazjo Prototype (Backend-enabled customer data)
   - Products + orders sync via native Node backend (/api/*) backed by Supabase
   - Cart / profile / rewards remain localStorage for prototype speed
   - Falls back to local demo data when backend is unavailable
*/

const LS = {
  products: "jazjo_products_v1",
  cart: "jazjo_cart_v1",
  orders: "jazjo_orders_v1",
  profile: "jazjo_customer_profile_v1",
  rewards: "jazjo_rewards_v1"
};

const API_BASE = location.protocol === "file:" ? "http://localhost:3000" : "";
const DEMO_CUSTOMER_EMAIL = "customer@jazjo.com";
const money = (n) => `PHP ${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 0 })}`;

function load(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch(_e){
    return fallback;
  }
}
function save(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}

function qs(sel){ return document.querySelector(sel); }
function qsa(sel){ return [...document.querySelectorAll(sel)]; }

function apiUrl(path){
  return `${API_BASE}${path}`;
}

function getAccessToken(){
  return localStorage.getItem("jazjo_access_token") || sessionStorage.getItem("jazjo_access_token") || "";
}

async function apiFetch(path, options = {}){
  const token = getAccessToken();
  const res = await fetch(apiUrl(path), {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    },
    ...options
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text || "Invalid server response" }; }
  if(!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function getCurrentCustomerEmail(){
  return localStorage.getItem("jazjo_user") || DEMO_CUSTOMER_EMAIL;
}

function placeholderImage(label){
  const safe = String(label || "Product").replace(/[<&>]/g, "");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700">
      <defs>
        <linearGradient id="g" x1="0" x2="1">
          <stop offset="0" stop-color="#d1fae5"/>
          <stop offset="1" stop-color="#dbeafe"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="700" fill="url(#g)"/>
      <circle cx="600" cy="320" r="170" fill="#16a34a" opacity=".12"/>
      <text x="50%" y="52%" font-size="56" text-anchor="middle" fill="#0f172a" font-family="Arial" font-weight="800">${safe}</text>
      <text x="50%" y="60%" font-size="26" text-anchor="middle" fill="#64748b" font-family="Arial" font-weight="700">Jazjo Product</text>
    </svg>
  `.trim();
  return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
}

function normalizeProduct(p){
  return {
    id: p.id,
    dbId: p.dbId || p.db_id || null,
    sku: p.sku || p.id,
    name: p.name,
    category: p.category,
    unit: p.unit,
    price: Number(p.price || 0),
    stockCases: Number(p.stockCases ?? p.stock_cases ?? 0),
    img: p.img || p.image_url || placeholderImage(p.name)
  };
}

function normalizeStatusLabel(status){
  const map = {
    pending_payment: "Order Placed",
    order_placed: "Order Placed",
    preparing: "Preparing",
    in_transit: "In Transit",
    out_for_delivery: "Out for Delivery",
    delivered: "Delivered",
    cancelled: "Cancelled"
  };
  return map[status] || status || "Order Placed";
}

function currentStatusIndex(status){
  const map = {
    "Order Placed": 0,
    "Preparing": 1,
    "In Transit": 2,
    "Out for Delivery": 3,
    "Delivered": 4,
    "Cancelled": 0
  };
  return map[status] ?? 0;
}

function nowStamp(){
  const d = new Date();
  const opts = {year:"numeric", month:"short", day:"numeric"};
  const t = d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
  return `${d.toLocaleDateString("en-US", opts)} - ${t}`;
}

function buildTimeline(status, statusEvents){
  const defaults = [
    {title:"Order Placed", note:"Customer placed the order successfully."},
    {title:"Preparing", note:"Order will be packed and checked by staff."},
    {title:"In Transit", note:"Order is on the way to customer location."},
    {title:"Out for Delivery", note:"Rider is near the destination."},
    {title:"Delivered", note:"Order is received by the customer."}
  ];
  const byTitle = new Map((statusEvents || []).map(e => [normalizeStatusLabel(e.status), e]));
  return defaults.map(step => ({
    ...step,
    time: byTitle.get(step.title)?.created_at || "Pending",
    note: byTitle.get(step.title)?.note || step.note
  }));
}

function normalizeOrderForUI(order){
  const status = normalizeStatusLabel(order.status);
  const items = (order.items || order.order_items || []).map(it => ({
    productId: it.sku || it.product_id || it.productId,
    name: it.name,
    price: Number(it.price ?? it.unit_price ?? 0),
    qty: Number(it.qty || 0),
    img: it.img || it.image_url || placeholderImage(it.name)
  }));
  return {
    id: order.id || order.order_code,
    createdAt: order.createdAt || order.created_at || nowStamp(),
    customerName: order.customerName || order.customer_name || "Customer",
    contact: order.contact || "",
    address: order.address || "",
    paymentMethod: order.paymentMethod || order.payment_method || "QRPH",
    subtotal: Number(order.subtotal || 0),
    deliveryFee: Number(order.deliveryFee ?? order.delivery_fee ?? 0),
    total: Number(order.total || 0),
    status,
    items,
    deliveryTimeline: order.deliveryTimeline || buildTimeline(status, order.status_events)
  };
}

function getProducts(){ return (load(LS.products, []) || []).map(normalizeProduct); }
function setProducts(list){ save(LS.products, (list || []).map(normalizeProduct)); }
function getCart(){ return load(LS.cart, []); }
function setCart(items){ save(LS.cart, items); }
function getOrders(){ return (load(LS.orders, []) || []).map(normalizeOrderForUI); }
function setOrders(list){ save(LS.orders, (list || []).map(normalizeOrderForUI)); }

async function syncProductsFromApi(){
  const data = await apiFetch("/api/products");
  const list = (data.products || []).map(normalizeProduct);
  setProducts(list);
  return list;
}

async function fetchOrdersFromApi(){
  const data = await apiFetch("/api/orders");
  return (data.orders || []).map(normalizeOrderForUI);
}

async function fetchOrderDetailsFromApi(orderCode){
  const data = await apiFetch(`/api/orders/${encodeURIComponent(orderCode)}`);
  return data.order ? normalizeOrderForUI(data.order) : null;
}

async function createOrderApi(payload){
  return await apiFetch("/api/orders", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

function addToCart(productId, qty=1){
  const cart = getCart();
  const found = cart.find(i => i.productId === productId);
  if(found) found.qty += qty;
  else cart.push({productId, qty});
  setCart(cart);
}

function cartCount(){
  return getCart().reduce((a,b)=>a+Number(b.qty || 0),0);
}

function computeCartTotals(){
  const products = getProducts();
  const cart = getCart();
  const lines = cart.map(ci=>{
    const p = products.find(x=>x.id===ci.productId);
    return { ...ci, p, lineTotal: p ? p.price * ci.qty : 0 };
  }).filter(x=>x.p);

  const subtotal = lines.reduce((a,b)=>a+b.lineTotal,0);
  const deliveryFee = subtotal >= 800 ? 0 : (subtotal === 0 ? 0 : 60);
  const total = subtotal + deliveryFee;
  return {lines, subtotal, deliveryFee, total};
}

function setCartBadge(){
  const el = qs("[data-cart-count]");
  if(!el) return;
  el.textContent = cartCount();
}

function initPublicNav(){
  setCartBadge();
  qsa("[data-back]").forEach(btn => btn.addEventListener("click", ()=>history.back()));
}

function renderShop(){
  initPublicNav();
  const grid = qs("#productGrid");
  if(!grid) return;

  let products = getProducts();
  const search = qs("#search");
  const cat = qs("#category");

  const draw = ()=>{
    const categories = ["All", ...new Set(products.map(p=>p.category))];
    cat.innerHTML = categories.map(c=>`<option value="${c}">${c}</option>`).join("");
    if(!categories.includes(cat.value)) cat.value = "All";

    const term = (search.value || "").toLowerCase();
    const selected = cat.value || "All";
    const filtered = products.filter(p=>{
      const okTerm = !term || p.name.toLowerCase().includes(term) || p.category.toLowerCase().includes(term);
      const okCat = selected === "All" || p.category === selected;
      return okTerm && okCat;
    });

    grid.innerHTML = filtered.map(p=>{
      const stockLabel = p.stockCases <= 0 ? `<span class="badge red">Out of Stock</span>` :
                         p.stockCases <= 10 ? `<span class="badge yellow">Low Stock</span>` :
                         `<span class="badge green">In Stock</span>`;
      return `
        <div class="productCard">
          <div class="productMedia">
            <img src="${p.img}" alt="${p.name}" />
          </div>
          <div class="productBody">
            <p class="productName">${p.name}</p>
            <p class="productMeta">${p.category} - ${p.unit} - ${stockLabel}</p>
            <p class="productPrice">${money(p.price)}</p>
            <div class="productActions">
              <button class="btn" data-add="${p.id}" ${p.stockCases<=0 ? "disabled style='opacity:.6;cursor:not-allowed'" : ""}>Add to Cart</button>
              <a class="btn back" href="customer-shop.html" title="Refresh" style="padding:11px 12px;">R</a>
            </div>
          </div>
        </div>
      `;
    }).join("");

    qsa("[data-add]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        addToCart(btn.dataset.add, 1);
        setCartBadge();
        btn.textContent = "Added";
        setTimeout(()=>btn.textContent="Add to Cart", 900);
      });
    });
  };

  search.addEventListener("input", draw);
  cat.addEventListener("change", draw);
  draw();
  syncProductsFromApi()
    .then(list=>{ products = list; draw(); })
    .catch(err => {
      console.error(err);
      grid.innerHTML = `<div class="card"><div class="small">Failed to load products from database: ${err.message}</div></div>`;
    });
}

function renderCart(){
  initPublicNav();
  const list = qs("#cartList");
  if(!list) return;

  const draw = ()=>{
    const {lines, subtotal, deliveryFee, total} = computeCartTotals();
    if(lines.length===0){
      list.innerHTML = `<div class="small">Your cart is empty. Go to <a href="customer-shop.html" style="color:#16a34a;font-weight:900">Shop</a>.</div>`;
      qs("#subtotal").textContent = money(0);
      qs("#deliveryFee").textContent = money(0);
      qs("#total").textContent = money(0);
      return;
    }

    list.innerHTML = lines.map(li=>`
      <div class="card" style="box-shadow:none;border-radius:18px;margin-bottom:10px">
        <div class="row" style="justify-content:space-between">
          <div class="row" style="gap:12px">
            <div style="width:60px;height:60px;border-radius:14px;overflow:hidden;border:1px solid rgba(229,231,235,.9)">
              <img src="${li.p.img}" alt="${li.p.name}" style="width:100%;height:100%;object-fit:cover"/>
            </div>
            <div>
              <div style="font-weight:1100">${li.p.name}</div>
              <div class="small">${li.p.category} - ${money(li.p.price)} each</div>
            </div>
          </div>
          <div class="row">
            <button class="btn back" data-dec="${li.p.id}">-</button>
            <span class="badge" style="min-width:46px;justify-content:center">${li.qty}</span>
            <button class="btn back" data-inc="${li.p.id}">+</button>
            <span style="font-weight:1200;min-width:110px;text-align:right">${money(li.lineTotal)}</span>
            <button class="btn back" data-del="${li.p.id}">Remove</button>
          </div>
        </div>
      </div>
    `).join("");

    qs("#subtotal").textContent = money(subtotal);
    qs("#deliveryFee").textContent = money(deliveryFee);
    qs("#total").textContent = money(total);

    qsa("[data-inc]").forEach(b=>b.onclick=()=>updateQty(b.dataset.inc, +1));
    qsa("[data-dec]").forEach(b=>b.onclick=()=>updateQty(b.dataset.dec, -1));
    qsa("[data-del]").forEach(b=>b.onclick=()=>removeItem(b.dataset.del));
  };

  const updateQty = (pid, delta)=>{
    const cart = getCart();
    const it = cart.find(i=>i.productId===pid);
    if(!it) return;
    it.qty += delta;
    if(it.qty<=0) cart.splice(cart.indexOf(it),1);
    setCart(cart);
    setCartBadge();
    draw();
  };

  const removeItem = (pid)=>{
    setCart(getCart().filter(i=>i.productId!==pid));
    setCartBadge();
    draw();
  };

  qs("#clearCart").onclick = ()=>{
    setCart([]);
    setCartBadge();
    draw();
  };

  qs("#checkoutForm").addEventListener("submit", async (e)=>{
    e.preventDefault();

    const {lines, subtotal, deliveryFee, total} = computeCartTotals();
    if(lines.length===0) return;

    const customerName = qs("#shipName").value.trim();
    const contact = qs("#shipContact").value.trim();
    const address = qs("#shipAddress").value.trim();
    const paymentMethod = qs("#paymentMethod").value;
    let createdOrder = null;
    let checkoutUrl = null;
    try{
      const result = await createOrderApi({
        customerName,
        contact,
        address,
        paymentMethod,
        items: lines.map(l => ({ productId: l.p.id, qty: l.qty }))
      });
      createdOrder = result.order ? normalizeOrderForUI(result.order) : null;
      checkoutUrl = result.checkoutUrl || null;
    }catch(err){
      alert(`Order creation failed: ${err.message}`);
      return;
    }
    if(!createdOrder){
      alert("Order creation failed: invalid server response.");
      return;
    }

    const existingOrders = getOrders().filter(o => o.id !== createdOrder.id);
    setOrders([createdOrder, ...existingOrders]);

    setCart([]);
    setCartBadge();
    if(checkoutUrl){
      window.location.href = checkoutUrl;
      return;
    }
    window.location.href = `customer-orders.html?new=${encodeURIComponent(createdOrder.id)}`;
  });

  draw();
  syncProductsFromApi().then(()=>draw()).catch(err => console.error(err));
}

function statusBadgeClass(status){
  if(status === "Delivered") return "green";
  if(status === "In Transit" || status === "Out for Delivery") return "blue";
  if(status === "Cancelled") return "red";
  return "yellow";
}

function renderOrders(){
  initPublicNav();
  const wrap = qs("#ordersWrap");
  if(!wrap) return;

  const empty = `<div class="card"><div class="small">No orders yet. Go to <a href="customer-shop.html" style="color:#16a34a;font-weight:900">Shop</a> and place an order.</div></div>`;
  const draw = (orders)=>{
    if(!orders.length){ wrap.innerHTML = empty; return; }
    wrap.innerHTML = `
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <div>
            <div style="font-weight:1200;font-size:18px">Your Orders</div>
            <div class="small">Click View Details to open the order details page.</div>
          </div>
          <a class="btn" href="customer-shop.html">Shop Again</a>
        </div>
        <table class="table">
          <thead><tr><th>Order ID</th><th>Date</th><th>Total</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${orders.map(o=>`
              <tr>
                <td style="font-weight:1000">${o.id}</td>
                <td>${o.createdAt}</td>
                <td style="font-weight:1000">${money(o.total)}</td>
                <td><span class="badge ${statusBadgeClass(o.status)}">${o.status}</span></td>
                <td><a class="btn back" href="customer-order-details.html?id=${encodeURIComponent(o.id)}">View Details</a></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  };

  wrap.innerHTML = `<div class="card"><div class="small">Loading orders...</div></div>`;
  fetchOrdersFromApi()
    .then(orders => { setOrders(orders); draw(orders); })
    .catch(err => {
      console.error(err);
      wrap.innerHTML = `<div class="card"><div class="small">Failed to load orders from database: ${err.message}</div></div>`;
    });
}

function renderOrderDetails(){
  initPublicNav();
  const box = qs("#detailsBox");
  if(!box) return;

  const params = new URLSearchParams(location.search);
  const id = params.get("id");

  const draw = (order)=>{
    if(!order){
      box.innerHTML = `<div class="card"><div class="small">Order not found. Go back to <a href="customer-orders.html" style="color:#16a34a;font-weight:900">Orders</a>.</div></div>`;
      return;
    }

    box.innerHTML = `
      <div class="topbar" style="margin-bottom:14px">
        <div>
          <h1>Order Details</h1>
          <p>${order.id} - ${order.createdAt}</p>
        </div>
        <div class="row">
          <a class="btn back" href="customer-orders.html">Back to Orders</a>
          <button class="btn back" data-back>Back</button>
        </div>
      </div>

      <div class="grid grid2">
        <div class="card">
          <div class="row" style="justify-content:space-between">
            <div style="font-weight:1200;font-size:18px">Summary</div>
            <span class="badge ${statusBadgeClass(order.status)}">${order.status}</span>
          </div>
          <div class="hr"></div>
          <div class="small"><b>Customer:</b> ${order.customerName}</div>
          <div class="small"><b>Contact:</b> ${order.contact}</div>
          <div class="small"><b>Address:</b> ${order.address}</div>
          <div class="small"><b>Payment:</b> ${order.paymentMethod}</div>
          <div class="hr"></div>
          <div class="row" style="justify-content:space-between"><div class="small"><b>Subtotal</b></div><div style="font-weight:1100">${money(order.subtotal)}</div></div>
          <div class="row" style="justify-content:space-between"><div class="small"><b>Delivery Fee</b></div><div style="font-weight:1100">${money(order.deliveryFee)}</div></div>
          <div class="row" style="justify-content:space-between"><div class="small"><b>Total</b></div><div style="font-weight:1300;font-size:18px">${money(order.total)}</div></div>
        </div>

        <div class="card">
          <div style="font-weight:1200;font-size:18px">Items</div>
          <div class="hr"></div>
          ${(order.items || []).map(it=>`
            <div class="row" style="justify-content:space-between;margin-bottom:10px">
              <div class="row" style="gap:12px">
                <div style="width:56px;height:56px;border-radius:14px;overflow:hidden;border:1px solid rgba(229,231,235,.9)">
                  <img src="${it.img}" alt="${it.name}" style="width:100%;height:100%;object-fit:cover"/>
                </div>
                <div>
                  <div style="font-weight:1100">${it.name}</div>
                  <div class="small">${money(it.price)} - Qty ${it.qty}</div>
                </div>
              </div>
              <div style="font-weight:1200">${money(it.price * it.qty)}</div>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <div style="font-weight:1200;font-size:18px">Delivery Tracking</div>
        <div class="small">Status updates only (no GPS): Order Placed -> Preparing -> In Transit -> Out for Delivery -> Delivered.</div>
        <div class="timeline" style="margin-top:12px">
          <div class="trackHead">
            <div class="iconBox">D</div>
            <div>
              <div style="font-weight:1200;font-size:18px">Active Delivery</div>
              <div class="small">Order #${order.id}</div>
            </div>
          </div>

          ${order.deliveryTimeline.map((t, idx)=>{
            const isDone = idx <= currentStatusIndex(order.status);
            return `
              <div class="step">
                <div>
                  <div class="dot ${isDone ? "done" : ""}">${isDone ? "OK" : "."}</div>
                  ${idx < order.deliveryTimeline.length-1 ? `<div class="line" style="height:70px"></div>` : ``}
                </div>
                <div class="info" style="${!isDone && t.time==="Pending" ? "opacity:.6" : ""}">
                  <h4>${t.title}</h4>
                  <div class="meta">${t.time || "Pending"}</div>
                  <p>${t.note}</p>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
    qsa("[data-back]").forEach(btn => btn.addEventListener("click", ()=>history.back()));
  };

  box.innerHTML = `<div class="card"><div class="small">Loading order details...</div></div>`;
  if(id){
    fetchOrderDetailsFromApi(id)
      .then(order => {
        if(!order){ draw(null); return; }
        const merged = [order, ...getOrders().filter(o => o.id !== order.id)];
        setOrders(merged);
        draw(order);
      })
      .catch(err => {
        console.error(err);
        box.innerHTML = `<div class="card"><div class="small">Failed to load order details from database: ${err.message}</div></div>`;
      });
  } else {
    draw(null);
  }
}

function renderRewards(){
  initPublicNav();
  const hero = qs("#rewardHero");
  if(!hero) return;

  const drawRewards = (rw)=>{
    const points = Number(rw.points || 0);
    const next = 1500;
    const pct = Math.min(100, Math.round((points/next)*100));
    qs("#points").textContent = points.toLocaleString();
    qs("#nextText").textContent = `Next reward at ${next.toLocaleString()} points`;
    qs("#barFill").style.width = `${pct}%`;
  };

  apiFetch("/api/rewards")
    .then(data => drawRewards(data.rewards || {points: 0, totalSpent: 0}))
    .catch(err => {
      console.error(err);
      drawRewards({points: 0, totalSpent: 0});
    });

  qsa("[data-redeem]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      alert("Redeem flow is disabled until rewards write-back is implemented in the backend.");
    });
  });
}

function renderProfile(){
  initPublicNav();
  const form = qs("#profileForm");
  if(!form) return;

  apiFetch("/api/profile")
    .then(({profile}) => {
      qs("#pname").value = profile.full_name || "";
      qs("#pemail").value = profile.email || "";
      qs("#pcontact").value = profile.contact || "";
      qs("#paddress").value = profile.address || "";
    })
    .catch(err => {
      console.error(err);
      alert(`Failed to load profile from database: ${err.message}`);
    });

  form.addEventListener("submit",(e)=>{
    e.preventDefault();
    apiFetch("/api/profile", {
      method: "PUT",
      body: JSON.stringify({
        fullName: qs("#pname").value.trim(),
        contact: qs("#pcontact").value.trim(),
        address: qs("#paddress").value.trim()
      })
    })
      .then(() => alert("Profile saved."))
      .catch(err => alert(`Failed to save profile: ${err.message}`));
  });
}

function initProductUploader(){
  const file = qs("#prodImage");
  const preview = qs("#imgPreview");
  if(!file || !preview) return;

  file.addEventListener("change", ()=>{
    const f = file.files?.[0];
    if(!f) return;
    const ok = ["image/png","image/jpeg","image/jpg"].includes(f.type) || /\.(png|jpg|jpeg)$/i.test(f.name);
    if(!ok){
      alert("Please upload PNG or JPG only.");
      file.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      preview.src = reader.result;
      preview.dataset.base64 = reader.result;
    };
    reader.readAsDataURL(f);
  });
}

document.addEventListener("DOMContentLoaded", ()=>{
  initPublicNav();
  if(qs("#productGrid")) renderShop();
  if(qs("#cartList")) renderCart();
  if(qs("#ordersWrap")) renderOrders();
  if(qs("#detailsBox")) renderOrderDetails();
  if(qs("#rewardHero")) renderRewards();
  if(qs("#profileForm")) renderProfile();
  initProductUploader();
});
