/* Jazjo Prototype (No backend)
   - Products saved in localStorage (with optional PNG/JPG upload stored as base64)
   - Cart + checkout (QRPH/GCash/Maya/etc.)
   - Orders list + Order Details Page
   - Delivery tracking timeline (status updates only, no GPS)
   - Rewards points demo
*/

const LS = {
  products: "jazjo_products_v1",
  cart: "jazjo_cart_v1",
  orders: "jazjo_orders_v1",
  profile: "jazjo_customer_profile_v1",
  rewards: "jazjo_rewards_v1"
};

const money = (n) => `₱ ${Number(n).toLocaleString("en-PH", {minimumFractionDigits: 0})}`;

function load(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch(e){
    return fallback;
  }
}
function save(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}

function seedProductsIfEmpty(){
  const existing = load(LS.products, []);
  if(existing && existing.length) return;

  const placeholder = (label) => {
    // simple SVG placeholder as data URL (always works offline)
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
        <text x="50%" y="52%" font-size="56" text-anchor="middle" fill="#0f172a" font-family="Arial" font-weight="800">${label}</text>
        <text x="50%" y="60%" font-size="26" text-anchor="middle" fill="#64748b" font-family="Arial" font-weight="700">Upload JPG/PNG in Admin Inventory later</text>
      </svg>
    `.trim();
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
  };

  const products = [
    {id:"P001", name:"Cola 1.5L", category:"Softdrinks", unit:"Bottle", price:55, stockCases:25, img:placeholder("Cola 1.5L")},
    {id:"P002", name:"Iced Tea 1L", category:"Juice/Tea", unit:"Bottle", price:65, stockCases:7, img:placeholder("Iced Tea 1L")},
    {id:"P003", name:"Energy Drink 250ml", category:"Energy", unit:"Can", price:30, stockCases:0, img:placeholder("Energy Drink")},
    {id:"P004", name:"Lemon Soda 330ml", category:"Softdrinks", unit:"Can", price:28, stockCases:18, img:placeholder("Lemon Soda")},
    {id:"P005", name:"Bottled Water 500ml", category:"Water", unit:"Bottle", price:12, stockCases:40, img:placeholder("Bottled Water")},
    {id:"P006", name:"Orange Juice 1L", category:"Juice/Tea", unit:"Bottle", price:78, stockCases:10, img:placeholder("Orange Juice")}
  ];
  save(LS.products, products);
}

function getProducts(){ seedProductsIfEmpty(); return load(LS.products, []); }
function setProducts(list){ save(LS.products, list); }

function getCart(){ return load(LS.cart, []); }
function setCart(items){ save(LS.cart, items); }

function addToCart(productId, qty=1){
  const cart = getCart();
  const found = cart.find(i => i.productId === productId);
  if(found) found.qty += qty;
  else cart.push({productId, qty});
  setCart(cart);
}

function cartCount(){
  return getCart().reduce((a,b)=>a+b.qty,0);
}

function getOrders(){ return load(LS.orders, []); }
function setOrders(list){ save(LS.orders, list); }

function makeOrderId(){
  const d = new Date();
  const pad = (n)=> String(n).padStart(2,"0");
  return `ORD-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${Math.floor(100+Math.random()*900)}`;
}

function nowStamp(){
  const d = new Date();
  const opts = {year:"numeric", month:"short", day:"numeric"};
  const t = d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
  return `${d.toLocaleDateString("en-US", opts)} • ${t}`;
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

/* ---------- Rendering Helpers ---------- */
function qs(sel){ return document.querySelector(sel); }
function qsa(sel){ return [...document.querySelectorAll(sel)]; }

function setCartBadge(){
  const el = qs("[data-cart-count]");
  if(!el) return;
  el.textContent = cartCount();
}

function initPublicNav(){
  setCartBadge();
  qsa("[data-back]").forEach(btn => btn.addEventListener("click", ()=>history.back()));
}

/* ---------- CUSTOMER SHOP ---------- */
function renderShop(){
  initPublicNav();
  const grid = qs("#productGrid");
  if(!grid) return;

  const products = getProducts();
  const search = qs("#search");
  const cat = qs("#category");

  const categories = ["All", ...new Set(products.map(p=>p.category))];
  cat.innerHTML = categories.map(c=>`<option value="${c}">${c}</option>`).join("");

  const draw = ()=>{
    const term = (search.value || "").toLowerCase();
    const c = cat.value;

    const filtered = products.filter(p=>{
      const okTerm = !term || p.name.toLowerCase().includes(term) || p.category.toLowerCase().includes(term);
      const okCat = (c==="All") || (p.category===c);
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
            <p class="productMeta">${p.category} • ${p.unit} • ${stockLabel}</p>
            <p class="productPrice">${money(p.price)}</p>
            <div class="productActions">
              <button class="btn" data-add="${p.id}" ${p.stockCases<=0 ? "disabled style='opacity:.6;cursor:not-allowed'" : ""}>
                Add to Cart
              </button>
              <a class="btn back" href="customer-shop.html" title="Refresh" style="padding:11px 12px;">↻</a>
            </div>
          </div>
        </div>
      `;
    }).join("");

    qsa("[data-add]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        addToCart(btn.dataset.add, 1);
        setCartBadge();
        btn.textContent = "Added ✓";
        setTimeout(()=>btn.textContent="Add to Cart", 900);
      });
    });
  };

  search.addEventListener("input", draw);
  cat.addEventListener("change", draw);
  draw();
}

/* ---------- CART / CHECKOUT ---------- */
function renderCart(){
  initPublicNav();
  const list = qs("#cartList");
  if(!list) return;

  const products = getProducts();

  const draw = ()=>{
    const {lines, subtotal, deliveryFee, total} = computeCartTotals();

    if(lines.length===0){
      list.innerHTML = `<div class="small">Your cart is empty. Go to <a href="customer-shop.html" style="color:#16a34a;font-weight:900">Shop</a>.</div>`;
      qs("#subtotal").textContent = money(0);
      qs("#deliveryFee").textContent = money(0);
      qs("#total").textContent = money(0);
      return;
    }

    list.innerHTML = lines.map(li=>{
      return `
        <div class="card" style="box-shadow:none;border-radius:18px;margin-bottom:10px">
          <div class="row" style="justify-content:space-between">
            <div class="row" style="gap:12px">
              <div style="width:60px;height:60px;border-radius:14px;overflow:hidden;border:1px solid rgba(229,231,235,.9)">
                <img src="${li.p.img}" alt="${li.p.name}" style="width:100%;height:100%;object-fit:cover"/>
              </div>
              <div>
                <div style="font-weight:1100">${li.p.name}</div>
                <div class="small">${li.p.category} • ${money(li.p.price)} each</div>
              </div>
            </div>
            <div class="row">
              <button class="btn back" data-dec="${li.p.id}">−</button>
              <span class="badge" style="min-width:46px;justify-content:center">${li.qty}</span>
              <button class="btn back" data-inc="${li.p.id}">+</button>
              <span style="font-weight:1200;min-width:110px;text-align:right">${money(li.lineTotal)}</span>
              <button class="btn back" data-del="${li.p.id}">Remove</button>
            </div>
          </div>
        </div>
      `;
    }).join("");

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
    const cart = getCart().filter(i=>i.productId!==pid);
    setCart(cart);
    setCartBadge();
    draw();
  };

  qs("#clearCart").onclick = ()=>{
    setCart([]);
    setCartBadge();
    draw();
  };

  qs("#checkoutForm").addEventListener("submit", (e)=>{
    e.preventDefault();

    const {lines, subtotal, deliveryFee, total} = computeCartTotals();
    if(lines.length===0) return;

    const name = qs("#shipName").value.trim();
    const contact = qs("#shipContact").value.trim();
    const address = qs("#shipAddress").value.trim();
    const payment = qs("#paymentMethod").value;

    const orderId = makeOrderId();
    const items = lines.map(l=>({productId:l.p.id, name:l.p.name, price:l.p.price, qty:l.qty, img:l.p.img}));

    const order = {
      id: orderId,
      createdAt: nowStamp(),
      customerName: name,
      contact,
      address,
      paymentMethod: payment,
      subtotal,
      deliveryFee,
      total,
      status: "Order Placed",
      items,
      deliveryTimeline: [
        {title:"Order Placed", time: nowStamp(), note:"Customer placed the order successfully."},
        {title:"Preparing", time:"Pending", note:"Order will be packed and checked by staff."},
        {title:"In Transit", time:"Pending", note:"Order is on the way to customer location."},
        {title:"Out for Delivery", time:"Pending", note:"Rider is near the destination."},
        {title:"Delivered", time:"Pending", note:"Order is received by the customer."}
      ]
    };

    const orders = getOrders();
    orders.unshift(order);
    setOrders(orders);

    // Rewards points demo
    const rw = load(LS.rewards, {points: 0, totalSpent: 0});
    rw.totalSpent += total;
    rw.points += Math.floor(total / 100) * 10; // +10 points per ₱100 spent (demo)
    save(LS.rewards, rw);

    // clear cart
    setCart([]);
    setCartBadge();

    // redirect to orders
    window.location.href = `customer-orders.html?new=${encodeURIComponent(orderId)}`;
  });

  draw();
}

/* ---------- ORDERS LIST ---------- */
function renderOrders(){
  initPublicNav();
  const wrap = qs("#ordersWrap");
  if(!wrap) return;

  const orders = getOrders();
  const empty = `<div class="card"><div class="small">No orders yet. Go to <a href="customer-shop.html" style="color:#16a34a;font-weight:900">Shop</a> and place an order.</div></div>`;

  if(!orders.length){
    wrap.innerHTML = empty;
    return;
  }

  wrap.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div>
          <div style="font-weight:1200;font-size:18px">Your Orders</div>
          <div class="small">Click “View Details” to open the order details page (not a modal).</div>
        </div>
        <a class="btn" href="customer-shop.html">Shop Again</a>
      </div>
      <table class="table">
        <thead><tr><th>Order ID</th><th>Date</th><th>Total</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${orders.map(o=>{
            const badge = o.status==="Delivered" ? "green" :
                          o.status==="In Transit" || o.status==="Out for Delivery" ? "blue" :
                          o.status==="Preparing" ? "yellow" : "yellow";
            return `
              <tr>
                <td style="font-weight:1000">${o.id}</td>
                <td>${o.createdAt}</td>
                <td style="font-weight:1000">${money(o.total)}</td>
                <td><span class="badge ${badge}">${o.status}</span></td>
                <td><a class="btn back" href="customer-order-details.html?id=${encodeURIComponent(o.id)}">View Details</a></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

/* ---------- ORDER DETAILS PAGE ---------- */
function renderOrderDetails(){
  initPublicNav();
  const box = qs("#detailsBox");
  if(!box) return;

  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const orders = getOrders();
  const order = orders.find(o=>o.id===id);

  if(!order){
    box.innerHTML = `<div class="card"><div class="small">Order not found. Go back to <a href="customer-orders.html" style="color:#16a34a;font-weight:900">Orders</a>.</div></div>`;
    return;
  }

  const statusBadge = (s)=>{
    if(s==="Delivered") return "green";
    if(s==="Out for Delivery" || s==="In Transit") return "blue";
    if(s==="Preparing") return "yellow";
    return "yellow";
  };

  box.innerHTML = `
    <div class="topbar" style="margin-bottom:14px">
      <div>
        <h1>Order Details</h1>
        <p>${order.id} • ${order.createdAt}</p>
      </div>
      <div class="row">
        <a class="btn back" href="customer-orders.html">← Back to Orders</a>
        <button class="btn back" data-back>Back</button>
      </div>
    </div>

    <div class="grid grid2">
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <div style="font-weight:1200;font-size:18px">Summary</div>
          <span class="badge ${statusBadge(order.status)}">${order.status}</span>
        </div>

        <div class="hr"></div>

        <div class="small"><b>Customer:</b> ${order.customerName}</div>
        <div class="small"><b>Contact:</b> ${order.contact}</div>
        <div class="small"><b>Address:</b> ${order.address}</div>
        <div class="small"><b>Payment:</b> ${order.paymentMethod}</div>

        <div class="hr"></div>

        <div class="row" style="justify-content:space-between">
          <div class="small"><b>Subtotal</b></div><div style="font-weight:1100">${money(order.subtotal)}</div>
        </div>
        <div class="row" style="justify-content:space-between">
          <div class="small"><b>Delivery Fee</b></div><div style="font-weight:1100">${money(order.deliveryFee)}</div>
        </div>
        <div class="row" style="justify-content:space-between">
          <div class="small"><b>Total</b></div><div style="font-weight:1300;font-size:18px">${money(order.total)}</div>
        </div>
      </div>

      <div class="card">
        <div style="font-weight:1200;font-size:18px">Items</div>
        <div class="hr"></div>

        ${order.items.map(it=>`
          <div class="row" style="justify-content:space-between;margin-bottom:10px">
            <div class="row" style="gap:12px">
              <div style="width:56px;height:56px;border-radius:14px;overflow:hidden;border:1px solid rgba(229,231,235,.9)">
                <img src="${it.img}" alt="${it.name}" style="width:100%;height:100%;object-fit:cover"/>
              </div>
              <div>
                <div style="font-weight:1100">${it.name}</div>
                <div class="small">${money(it.price)} • Qty ${it.qty}</div>
              </div>
            </div>
            <div style="font-weight:1200">${money(it.price * it.qty)}</div>
          </div>
        `).join("")}
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div style="font-weight:1200;font-size:18px">Delivery Tracking</div>
      <div class="small">Status updates only (no GPS): Order Placed → Preparing → In Transit → Out for Delivery → Delivered.</div>

      <div class="timeline" style="margin-top:12px">
        <div class="trackHead">
          <div class="iconBox">🚚</div>
          <div>
            <div style="font-weight:1200;font-size:18px">Active Delivery</div>
            <div class="small">Order #${order.id}</div>
          </div>
        </div>

        ${order.deliveryTimeline.map((t, idx)=>{
          const done = order.status === t.title ||
                       ["Preparing","In Transit","Out for Delivery","Delivered"].includes(order.status) && idx < currentIndex(order.status);
          const isDone = (idx <= currentIndex(order.status));
          return `
            <div class="step">
              <div>
                <div class="dot ${isDone ? "done":""}">${isDone ? "✓":"•"}</div>
                ${idx < order.deliveryTimeline.length-1 ? `<div class="line" style="height:70px"></div>` : ``}
              </div>
              <div class="info" style="${!isDone && t.time==="Pending" ? "opacity:.6":""}">
                <h4>${t.title}</h4>
                <div class="meta">${isDone ? (t.time==="Pending" ? nowStamp() : t.time) : "Pending"}</div>
                <p>${t.note}</p>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;

  function currentIndex(status){
    const map = {
      "Order Placed": 0,
      "Preparing": 1,
      "In Transit": 2,
      "Out for Delivery": 3,
      "Delivered": 4
    };
    return map[status] ?? 0;
  }
}

/* ---------- REWARDS ---------- */
function renderRewards(){
  initPublicNav();
  const hero = qs("#rewardHero");
  if(!hero) return;

  const rw = load(LS.rewards, {points: 1250, totalSpent: 0}); // demo starts at 1250 if none
  if(!localStorage.getItem(LS.rewards)) save(LS.rewards, rw);

  const points = rw.points || 0;
  const next = 1500;
  const pct = Math.min(100, Math.round((points/next)*100));

  qs("#points").textContent = points.toLocaleString();
  qs("#nextText").textContent = `Next reward at ${next.toLocaleString()} points`;
  qs("#barFill").style.width = `${pct}%`;

  qsa("[data-redeem]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const cost = Number(btn.dataset.cost);
      if(points < cost){
        alert("Not enough points yet. Keep ordering to earn more points.");
        return;
      }
      const updated = load(LS.rewards, {points: points, totalSpent: 0});
      updated.points = Math.max(0, updated.points - cost);
      save(LS.rewards, updated);
      alert("Redeemed successfully! (Demo)");
      location.reload();
    });
  });
}

/* ---------- PROFILE ---------- */
function renderProfile(){
  initPublicNav();
  const form = qs("#profileForm");
  if(!form) return;

  const profile = load(LS.profile, {
    name:"Customer Name",
    email:"customer@jazjo.com",
    contact:"09XXXXXXXXX",
    address:""
  });

  qs("#pname").value = profile.name || "";
  qs("#pemail").value = profile.email || "";
  qs("#pcontact").value = profile.contact || "";
  qs("#paddress").value = profile.address || "";

  form.addEventListener("submit",(e)=>{
    e.preventDefault();
    const updated = {
      name: qs("#pname").value.trim(),
      email: qs("#pemail").value.trim(),
      contact: qs("#pcontact").value.trim(),
      address: qs("#paddress").value.trim()
    };
    save(LS.profile, updated);
    alert("Profile saved (Demo).");
  });
}

/* ---------- PRODUCT IMAGE UPLOAD (Admin Inventory can call this) ---------- */
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

/* ---------- Init by page ---------- */
document.addEventListener("DOMContentLoaded", ()=>{
  // Always update cart badge if present
  initPublicNav();

  // Page-specific
  if(qs("#productGrid")) renderShop();
  if(qs("#cartList")) renderCart();
  if(qs("#ordersWrap")) renderOrders();
  if(qs("#detailsBox")) renderOrderDetails();
  if(qs("#rewardHero")) renderRewards();
  if(qs("#profileForm")) renderProfile();

  // optional uploader (if admin page includes it)
  initProductUploader();
});
